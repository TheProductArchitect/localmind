"""
SSRF preflight contract.

assert_url_safe is the entry-point guard for `read_secure_webpage`. If a
prompt injection convinces the model to navigate at an internal address —
metadata services, RFC1918 nets, loopback, link-local — this is the function
that has to say no. Each test below pins one class of address that has
historically been used to pivot from a headless browser into internal
infrastructure.
"""

from unittest.mock import patch

import pytest

from secure_browser.browser import UnsafeUrlError, assert_url_safe


def _fake_resolve(ip: str):
    # Shape of socket.getaddrinfo's return: list of 5-tuples,
    # (family, type, proto, canonname, sockaddr); sockaddr[0] is the IP.
    return [(0, 0, 0, "", (ip, 0))]


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://127.0.0.1:5432/",
        "http://[::1]/",
    ],
)
def test_loopback_rejected(url):
    with pytest.raises(UnsafeUrlError):
        assert_url_safe(url)


@pytest.mark.parametrize(
    "ip",
    [
        "10.0.0.1",
        "10.255.255.255",
        "172.16.0.1",
        "172.31.255.254",
        "192.168.1.1",
    ],
)
def test_rfc1918_rejected(ip):
    with pytest.raises(UnsafeUrlError):
        assert_url_safe(f"http://{ip}/")


def test_aws_metadata_endpoint_rejected():
    # The classic SSRF target: link-local 169.254.169.254 hosts EC2/GCP
    # instance metadata, including IAM credentials. Must never be reachable
    # through the tool, even via a literal IP.
    with pytest.raises(UnsafeUrlError):
        assert_url_safe("http://169.254.169.254/latest/meta-data/")


def test_unspecified_and_multicast_rejected():
    with pytest.raises(UnsafeUrlError):
        assert_url_safe("http://0.0.0.0/")
    with pytest.raises(UnsafeUrlError):
        assert_url_safe("http://224.0.0.1/")


def test_non_http_scheme_rejected():
    for url in ("file:///etc/passwd", "ftp://example.com/", "gopher://example.com/", "javascript:alert(1)"):
        with pytest.raises(UnsafeUrlError):
            assert_url_safe(url)


def test_hostname_resolving_to_internal_ip_is_rejected():
    # DNS-rebinding shape: an external-looking hostname that resolves to a
    # private IP. The guard must catch this at resolution time, not just on
    # IP-literal URLs.
    with patch("secure_browser.browser.socket.getaddrinfo", return_value=_fake_resolve("10.0.0.5")):
        with pytest.raises(UnsafeUrlError):
            assert_url_safe("http://totally-external.example.com/")


def test_hostname_resolving_to_public_ip_is_allowed():
    with patch("secure_browser.browser.socket.getaddrinfo", return_value=_fake_resolve("93.184.216.34")):
        assert_url_safe("http://example.com/")  # does not raise


def test_dns_rebinding_any_private_answer_rejects():
    # If DNS returns multiple A records and ANY of them is private, refuse.
    # Closes the window where a hostile resolver returns a public IP on the
    # validation lookup and a private one on the actual fetch.
    with patch(
        "secure_browser.browser.socket.getaddrinfo",
        return_value=[(0, 0, 0, "", ("93.184.216.34", 0)), (0, 0, 0, "", ("127.0.0.1", 0))],
    ):
        with pytest.raises(UnsafeUrlError):
            assert_url_safe("http://mixed-answers.example.com/")
