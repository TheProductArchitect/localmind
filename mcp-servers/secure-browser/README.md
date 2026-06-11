# secure-browser-mcp

Single-tool MCP server. The LLM calls `read_secure_webpage(url)`; internally we:

1. Fetch the page with headless Chromium (Playwright).
2. Strip `<script>`, `<style>`, hidden nodes, and comments (BeautifulSoup).
3. Convert the remaining DOM to Markdown (markdownify).
4. Scan the Markdown with `llm-guard`'s PromptInjection scanner.
5. Return clean Markdown — or a sterile `[SECURITY ALERT]` string if hostile.

The LLM never sees raw HTML, never sees injected text, and never has to know
any of this is happening.

## Install

```bash
cd mcp-servers/secure-browser
./run.sh   # first run sets up .venv, installs deps, installs chromium
```

## Wire into LocalMind

Use the in-app `install_mcp_server` tool (or have Sora do it) with:

- **source**: `manual`
- **command**: absolute path to `mcp-servers/secure-browser/run.sh`
- **name**: `secure-browser`
- **description**: `Read a URL as sanitized Markdown with prompt-injection guard`

## Device selection

The gatekeeper logs its device on first scan. Override with:

```bash
SECURE_BROWSER_DEVICE=cpu|mps|cuda ./run.sh
```

Auto-detection order: `SECURE_BROWSER_DEVICE` → `cuda` → `mps` → `cpu`.
