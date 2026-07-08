import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Comment
from markdownify import markdownify
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

STRIP_TAGS = ("script", "style", "noscript", "svg", "iframe", "template", "link", "meta")
DEFAULT_TIMEOUT_MS = 15_000
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 secure-browser-mcp/0.1"
)

# Resource types we never need for "read this page as Markdown" — and that
# also happen to be the largest by byte volume. Blocking them cuts page
# weight by 5–50x, dodges binary blobs that would crash markdownify, and
# kills any pixel/font/CSS-driven side-channel exfil attempts.
BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet", "websocket"}


class UnsafeUrlError(ValueError):
    """Raised when a URL is rejected by the SSRF preflight."""


@dataclass
class FetchResult:
    url: str
    final_url: str
    title: str
    markdown: str
    timed_out: bool = False
    has_password_field: bool = False


def _is_private_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    # Cover the SSRF surface: loopback, RFC1918, link-local (incl. the AWS
    # 169.254.169.254 metadata endpoint), multicast, broadcast, reserved,
    # and unspecified (0.0.0.0 / ::).
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_url_safe(url: str) -> None:
    """Preflight check on a user-supplied URL.

    Raises UnsafeUrlError if the host resolves to an internal address. Run
    BEFORE calling Playwright so a malicious prompt can't make us issue even
    a single request to private infrastructure. The route interceptor inside
    fetch_markdown then catches sub-requests + redirects.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise UnsafeUrlError(f"scheme '{parsed.scheme}' is not allowed (http/https only)")
    host = parsed.hostname
    if not host:
        raise UnsafeUrlError("URL has no hostname")

    # If the host is already an IP literal, validate it directly. Otherwise
    # resolve every A/AAAA record and reject if ANY of them is private. This
    # is the DNS-rebinding defense — a hostile DNS that returns 1.2.3.4 on
    # first lookup and 127.0.0.1 on the second can still only hit addresses
    # in the union of results from this single call.
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise UnsafeUrlError(f"could not resolve host '{host}': {e}") from e
    for info in infos:
        ip = info[4][0]
        if _is_private_ip(ip):
            raise UnsafeUrlError(f"host '{host}' resolves to internal address {ip}")


def _sanitize(html: str) -> tuple[str, str, bool]:
    """Return (title, markdown, has_password_field) for a fetched document.

    Stripped: <script>, <style>, <noscript>, <svg>, <iframe>, <template>,
    <link>, <meta>, comments, and any node hidden via display:none,
    visibility:hidden, the HTML `hidden` attribute, or aria-hidden="true".
    These are the standard prompt-injection hiding places.

    has_password_field marks the page as a sensitive context (login/signup)
    — detected BEFORE stripping so hiding the form doesn't hide the signal.
    The server withholds such pages unless the caller passed
    allow_sensitive=true (which LocalMind's web-guard only sets for domains
    the user explicitly allowed).
    """
    soup = BeautifulSoup(html, "html.parser")

    has_password_field = soup.find("input", attrs={"type": "password"}) is not None

    for tag in soup(list(STRIP_TAGS)):
        tag.decompose()

    for c in soup.find_all(string=lambda s: isinstance(s, Comment)):
        c.extract()

    for el in soup.find_all(True):
        # Decomposing a hidden parent leaves its children in this snapshot
        # as dead nodes (attrs=None); touching them raises. Skip them.
        if el.decomposed:
            continue
        style = (el.get("style") or "").lower().replace(" ", "")
        if "display:none" in style or "visibility:hidden" in style:
            el.decompose()
            continue
        if el.has_attr("hidden") or el.get("aria-hidden") == "true":
            el.decompose()

    title = (soup.title.string.strip() if soup.title and soup.title.string else "") or ""
    body = soup.body or soup
    md = markdownify(str(body), heading_style="ATX")
    md = "\n".join(line.rstrip() for line in md.splitlines() if line.strip())
    return title, md, has_password_field


async def fetch_markdown(url: str, *, timeout_ms: int = DEFAULT_TIMEOUT_MS) -> FetchResult:
    # SSRF preflight on the entry URL. Sub-requests and redirects are caught
    # by the route interceptor below.
    assert_url_safe(url)

    timed_out = False
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(user_agent=DEFAULT_USER_AGENT)

            async def route_interceptor(route):
                req = route.request
                # Block heavy / non-HTML resource types outright.
                if req.resource_type in BLOCKED_RESOURCE_TYPES:
                    await route.abort()
                    return
                # Block any sub-request or redirect that lands on an
                # internal address. Done by re-running assert_url_safe so
                # the resolution rules stay in one place.
                try:
                    assert_url_safe(req.url)
                except UnsafeUrlError:
                    await route.abort()
                    return
                await route.continue_()

            await context.route("**/*", route_interceptor)

            page = await context.new_page()
            try:
                # `domcontentloaded` returns as soon as the parser is done,
                # without waiting for the full network-idle settle. That
                # combined with the hard timeout protects against pages
                # that intentionally hold connections open to DoS the tool.
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            except PlaywrightTimeoutError:
                # Don't give up — return whatever DOM was loaded before the
                # deadline. The sanitizer + injection scan still apply to
                # the partial content.
                timed_out = True

            html = await page.content()
            final_url = page.url
        finally:
            await browser.close()

    title, md, has_password_field = _sanitize(html)
    return FetchResult(
        url=url,
        final_url=final_url,
        title=title,
        markdown=md,
        timed_out=timed_out,
        has_password_field=has_password_field,
    )
