# secure-browser-mcp

Single-tool MCP server. The LLM calls `read_secure_webpage(url)`; internally we:

1. SSRF preflight — reject URLs resolving to loopback/private/link-local/metadata
   addresses (any private DNS answer rejects the whole URL).
2. Fetch with headless Chromium (Playwright): `domcontentloaded` + hard timeout,
   heavy resource types (image/media/font/stylesheet/websocket) aborted, every
   sub-request re-checked against the SSRF rules.
3. Strip `<script>`, `<style>`, hidden nodes, and comments (BeautifulSoup).
4. Sensitive-context check — pages containing a password field are withheld
   unless the host passed `allow_sensitive=true` (LocalMind's web-guard sets it
   only for domains the user explicitly granted).
5. Convert the remaining DOM to Markdown (markdownify).
6. Scan the Markdown with `llm-guard`'s PromptInjection scanner.
7. Return clean Markdown — or a sterile `[SECURITY ALERT]` string if hostile.

The LLM never sees raw HTML, never sees injected text, and never has to know
any of this is happening.

## Install

LocalMind bootstraps this automatically on first boot (MCP page shows progress).
Manual setup:

```bash
cd mcp-servers/secure-browser
./bootstrap.sh   # venv + deps + chromium + warms the injection-scanner model
./run.sh         # launcher used by the MCP host (fails fast if not bootstrapped)
```

`bootstrap.sh` must run with direct internet access — at runtime the MCP child
sits behind LocalMind's outbound allowlist proxy, so all downloads (pip,
chromium, the DeBERTa scanner weights) happen here, not on first use.

Tests: `.venv/bin/pip install -e ".[test]" && .venv/bin/pytest`

## Wire into LocalMind

The built-in MCP row (`builtin-secure-browser`) is registered by LocalMind on
boot when the bootstrap sentinel exists. Agents (and the `/browse` UI) call the
first-class tool **`read_secure_webpage`**, which wraps
`mcp_builtin-secure-browser_read_secure_webpage` and applies LocalMind's
web-guard (kill switch, site grants, sensitive domains) before the MCP runs.

Manual MCP install (optional / external hosts):

- **source**: `manual`
- **command**: absolute path to `mcp-servers/secure-browser/run.sh`
- **name**: `secure-browser`
- **description**: `Read a URL as sanitized Markdown with prompt-injection guard`

## Playwright browsers

`run.sh` detects an incomplete Cursor/sandbox `PLAYWRIGHT_BROWSERS_PATH`
(missing `chromium_headless_shell`) and falls back to the standard user cache
(`~/Library/Caches/ms-playwright` on macOS). Re-run `./bootstrap.sh` if Chromium
is missing entirely.

## Device selection

The gatekeeper logs its device on first scan. Override with:

```bash
SECURE_BROWSER_DEVICE=cpu|mps|cuda ./run.sh
```

Auto-detection order: `SECURE_BROWSER_DEVICE` → `cuda` → `mps` → `cpu`.
