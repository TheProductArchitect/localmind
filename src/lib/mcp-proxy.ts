import http from "http";
import net from "net";
import { listMcpServers } from "./db/mcp";
import { logSecurityEvent } from "./db/jobs";
import { logger } from "./logger";

let proxyPort = 0;
let started = false;

// Returns the union of every enabled MCP server's domain allowlist.
function allowedHosts(): Set<string> {
  const set = new Set<string>();
  for (const s of listMcpServers()) {
    if (!s.enabled) continue;
    try {
      for (const d of JSON.parse(s.allowlist || "[]")) set.add(String(d).toLowerCase());
    } catch {}
  }
  return set;
}

function isAllowed(host: string): boolean {
  const allow = allowedHosts();
  const h = host.toLowerCase().split(":")[0];
  // Loopback is NOT auto-allowed: an MCP server reaching LocalMind's own API
  // on localhost would be treated as the owner. It must be explicitly listed.
  for (const d of allow) {
    if (h === d || h.endsWith("." + d)) return true;
  }
  return false;
}

// Starts a localhost-only forward proxy. MCP child processes are pointed at it
// via HTTP_PROXY/HTTPS_PROXY so their outbound traffic can be allowlisted.
export function startMcpProxy(): number {
  if (started) return proxyPort;
  started = true;

  const server = http.createServer((req, res) => {
    const host = (req.headers.host || "").split(":")[0];
    if (!isAllowed(host)) {
      logSecurityEvent("mcp_network_blocked", `Blocked outbound request to ${host}`);
      res.writeHead(403); res.end("Blocked by LocalMind MCP network allowlist");
      return;
    }
    const target = new URL(req.url || "", `http://${req.headers.host}`);
    const proxyReq = http.request(
      { hostname: target.hostname, port: target.port || 80, path: target.pathname + target.search, method: req.method, headers: req.headers },
      (proxyRes) => { res.writeHead(proxyRes.statusCode || 502, proxyRes.headers); proxyRes.pipe(res); }
    );
    proxyReq.on("error", () => { res.writeHead(502); res.end("proxy error"); });
    req.pipe(proxyReq);
  });

  // HTTPS CONNECT tunnelling with the same allowlist check.
  server.on("connect", (req, clientSocket, head) => {
    const [host, port] = (req.url || "").split(":");
    if (!isAllowed(host)) {
      logSecurityEvent("mcp_network_blocked", `Blocked CONNECT to ${host}`);
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const serverSocket = net.connect(Number(port) || 443, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
    serverSocket.on("error", () => clientSocket.end());
  });

  server.listen(0, "127.0.0.1", () => {
    proxyPort = (server.address() as net.AddressInfo).port;
    logger.info("MCP network proxy started", { port: proxyPort });
  });
  return proxyPort;
}

export function getProxyEnv(): Record<string, string> {
  if (!proxyPort) startMcpProxy();
  if (!proxyPort) return {};
  const url = `http://127.0.0.1:${proxyPort}`;
  return { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url };
}
