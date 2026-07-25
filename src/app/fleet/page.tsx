"use client";

/**
 * /fleet — paired devices, MCP servers, models, plugins.
 *
 * v2 reshape: hero header, then four sub-surfaces presented as discrete
 * sections (Peers, MCP, Models, Plugins). Only the Peers section gets the
 * full deep-dive treatment here; MCP/Models/Plugins surface as link cards
 * to their existing pages — those keep their own deep UIs for now and will
 * be folded inline as a follow-on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { Wifi, Plus, RefreshCw, Trash2, ScanLine, ShieldCheck, Copy, Plug, Box, Package, ChevronRight, ChevronDown } from "lucide-react";

type PeerCapabilities = {
  app_version?: string;
  platform?: string;
  tls_fingerprint_short?: string;
  models?: Array<{ name: string; loaded?: boolean }>;
  tools?: string[];
  current_load?: { active_processes: number };
  gpu_available?: boolean;
};
type Peer = {
  peer_node_id: string;
  label: string | null;
  primary_addr: string | null;
  paired_at: number;
  last_seen_at: number | null;
  trusted: number;
  policy: {
    allow_self_actions: boolean;
    allowed_tools: string[];
    advertise_capabilities: boolean;
    accept_chat_relay?: boolean;
    accept_workspace_relay?: boolean;
    accept_tool_relay?: boolean;
    sync_conversations?: boolean;
  };
  capabilities: PeerCapabilities;
};

type PairingStart = {
  payload: Record<string, unknown>;
  payload_json: string;
  qr_svg: string;
  window: { token_short: string; issued_at: number; expires_at: number; ttl_ms: number };
};

function ageOf(ms: number | null): string {
  if (!ms) return "never";
  const d = Date.now() - ms;
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

export default function FleetPage() {
  const confirm = useConfirm();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pairing, setPairing] = useState<PairingStart | null>(null);
  const [pairingLabel, setPairingLabel] = useState("");
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptPayload, setAcceptPayload] = useState("");
  const [acceptLabel, setAcceptLabel] = useState("");
  const [accepting, setAccepting] = useState(false);
  const expiryRef = useRef<HTMLSpanElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/fleet/peers");
    const j = (await r.json()) as { peers: Peer[] };
    setPeers(j.peers || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => {
      if (!expiryRef.current) return;
      const remaining = pairing.window.expires_at - Date.now();
      if (remaining <= 0) { expiryRef.current.textContent = "expired"; clearInterval(t); return; }
      const m = Math.floor(remaining / 60_000);
      const s = Math.floor((remaining % 60_000) / 1000);
      expiryRef.current.textContent = `${m}:${String(s).padStart(2, "0")} left`;
    }, 500);
    return () => clearInterval(t);
  }, [pairing]);

  async function startPair() {
    const r = await fetch("/api/fleet/pair/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label_hint: pairingLabel || undefined }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || "Could not start pairing", "error"); return; }
    setPairing((await r.json()) as PairingStart);
  }
  function cancelPair() { setPairing(null); }
  async function copyPayload() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.payload_json);
    toast("Payload copied — paste it into the other device", "success");
  }
  async function accept() {
    setAccepting(true);
    try {
      const r = await fetch("/api/fleet/pair/accept", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload_json: acceptPayload.trim(), label_for_initiator: acceptLabel || undefined }),
      });
      const j = await r.json();
      if (!r.ok) { toast(j.error || "Pairing failed", "error"); return; }
      toast(`Paired with ${j.peer?.label || j.initiator_node_id}`, "success");
      setAcceptOpen(false); setAcceptPayload(""); setAcceptLabel("");
      load();
    } finally { setAccepting(false); }
  }
  async function unpair(peerId: string) {
    const ok = await confirm({
      title: "Unpair this device?",
      message: "All pinned trust is removed; you'd need to pair again to reconnect.",
      confirmLabel: "Unpair",
      destructive: true,
    });
    if (!ok) return;
    await fetch(`/api/fleet/peers/${peerId}`, { method: "DELETE" });
    load();
  }
  async function relabel(peer: Peer) {
    const next = prompt(`Rename "${peer.label || peer.peer_node_id}"`, peer.label || "");
    if (next === null) return;
    await fetch(`/api/fleet/peers/${peer.peer_node_id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: next || null }),
    });
    load();
  }
  async function togglePolicy(peer: Peer, key: keyof Peer["policy"], value: boolean) {
    await fetch(`/api/fleet/peers/${peer.peer_node_id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: { ...peer.policy, [key]: value } }),
    });
    load();
  }

  const sortedPeers = useMemo(() => [...peers].sort((a, b) => b.paired_at - a.paired_at), [peers]);
  const onlineCount = peers.filter((p) => p.last_seen_at && Date.now() - p.last_seen_at < 90_000).length;

  const [transportOpen, setTransportOpen] = useState(false);

  return (
    <div className="mx-auto max-w-4xl px-10 py-16">
      <header className="mb-12 flex items-end justify-between">
        <div>
          <p className="lm-micro mb-2">Fleet</p>
          <h1 className="lm-display">What Sora can reach</h1>
          <p className="lm-body mt-3 max-w-xl" style={{ color: "hsl(0 0% 100% / 0.5)" }}>
            Other computers running LocalMind that you&apos;ve paired with this one — your
            laptop, a homelab, a teammate&apos;s box. Once paired, chats can sync across
            devices (you&apos;ll still see which machine each message came from), and
            compute can land where load is lightest.
          </p>
          <div className="lm-transport mt-5 max-w-xl" data-open={transportOpen}>
            <button
              onClick={() => setTransportOpen((o) => !o)}
              className="lm-transport__head"
              aria-expanded={transportOpen}
              data-pulse="true"
            >
              <span className="lm-micro">How they connect</span>
              <ChevronDown
                className="h-3.5 w-3.5 ml-auto"
                style={{
                  color: "hsl(0 0% 100% / 0.4)",
                  transition: "transform var(--lm-dur-micro) var(--lm-ease-micro)",
                  transform: transportOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </button>
            {transportOpen && (
            <ul className="lm-transport__list">
              <li>
                <b>Direct over the local network.</b> Same Wi-Fi or Ethernet — the two
                machines talk to each other&apos;s IPs (e.g. <code>192.168.x.x:5000</code>).
                No cloud, no relay, no broker.
              </li>
              <li>
                <b>mTLS with pinned keys.</b> Pairing exchanges Ed25519 public keys via a
                single-use QR code; from then on, both sides verify the other&apos;s
                certificate fingerprint on every call. Random machines on your LAN can&apos;t
                impersonate a paired peer.
              </li>
              <li>
                <b>Identity is the machine, not a person.</b> There&apos;s no central account
                directory — each peer is identified by an Ed25519 fingerprint (the
                <code>node_id</code> shown next to its name) plus a free-form label the
                owner typed at pairing time (e.g. <i>&quot;Lab Linux&quot;</i>,
                <i>&quot;Spouse&apos;s laptop&quot;</i>). The fingerprint is the trust
                anchor; the label is just for humans. To verify out-of-band, read the
                fingerprint on the peer row and compare with the owner.
              </li>
              <li>
                <b>Off-LAN reach.</b> If you want to reach a peer that&apos;s not on the same
                network, run a VPN that puts both machines on one virtual network
                (Tailscale, WireGuard, ZeroTier) and use the VPN IP when pairing. LocalMind
                itself doesn&apos;t open any inbound port to the public internet.
              </li>
              <li>
                <b>Every call audited.</b> Both sides write the request/response to their
                own audit log with a shared Lamport clock so the two histories can be
                interleaved later.
              </li>
            </ul>
            )}
          </div>
        </div>
        <button onClick={load} className="lm-icon-btn" aria-label="Refresh" data-pulse="true">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Peers section */}
      <section className="mb-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="lm-micro">Paired LocalMind machines</p>
            <p className="lm-body mt-1" style={{ color: "hsl(0 0% 100% / 0.7)" }}>
              {peers.length === 0 ? "No paired machines yet — pair another LocalMind install to enable collaboration."
                : `${peers.length} paired · ${onlineCount} online`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const r = await fetch("/api/fleet/sync", { method: "POST" });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) { toast(j.error || "Sync failed", "error"); return; }
                toast(
                  j.messages
                    ? `Synced ${j.messages} message${j.messages === 1 ? "" : "s"} from ${j.peers} peer${j.peers === 1 ? "" : "s"}`
                    : `Checked ${j.peers || 0} peer${(j.peers || 0) === 1 ? "" : "s"} — already up to date`,
                  "success"
                );
                load();
              }}
              className="lm-action lm-action--ghost"
              data-pulse="true"
              disabled={peers.length === 0}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Sync chats
            </button>
            <button onClick={() => setAcceptOpen((o) => !o)} className="lm-action lm-action--ghost" data-pulse="true">
              <ScanLine className="h-3.5 w-3.5" /> Accept invitation
            </button>
            <button onClick={startPair} className="lm-action" data-pulse="true">
              <Plus className="h-3.5 w-3.5" /> Pair new machine
            </button>
          </div>
        </div>

        {pairing && (
          <PairingPanel
            pairing={pairing}
            expiryRef={expiryRef}
            label={pairingLabel}
            onLabelChange={setPairingLabel}
            onClose={cancelPair}
            onCopy={copyPayload}
          />
        )}

        {acceptOpen && (
          <AcceptPanel
            payload={acceptPayload}
            label={acceptLabel}
            accepting={accepting}
            onPayloadChange={setAcceptPayload}
            onLabelChange={setAcceptLabel}
            onAccept={accept}
            onClose={() => setAcceptOpen(false)}
          />
        )}

        {!loaded ? (
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading…</p>
        ) : sortedPeers.length === 0 ? (
          <p className="lm-body py-10 text-center" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
            No paired machines yet. Pair another LocalMind install to enable cross-machine work.
          </p>
        ) : (
          <div>
            {sortedPeers.map((p) => {
              const recent = p.last_seen_at && Date.now() - p.last_seen_at < 90_000;
              return (
                <div key={p.peer_node_id} className="lm-peer">
                  <div className="lm-peer__head">
                    <span className="lm-peer__dot" data-online={!!recent} />
                    <button onClick={() => relabel(p)} className="lm-peer__name" data-pulse="true">
                      {p.label || p.peer_node_id.slice(0, 12)}
                    </button>
                    <button
                      className="lm-chip"
                      style={{ fontFamily: "ui-monospace,monospace", cursor: "pointer" }}
                      title={`Click to copy the full fingerprint\n${p.peer_node_id}`}
                      onClick={async () => {
                        await navigator.clipboard.writeText(p.peer_node_id);
                        toast("Fingerprint copied — verify it with the peer's owner", "success");
                      }}
                      data-pulse="true"
                    >
                      {p.peer_node_id.slice(0, 12)}…
                    </button>
                    {p.capabilities?.platform && <span className="lm-chip">{p.capabilities.platform}</span>}
                    {p.capabilities?.gpu_available && <span className="lm-chip" data-tone="ok">GPU</span>}
                    <span className="lm-micro ml-auto" style={{ textTransform: "none", letterSpacing: 0 }}>
                      last seen {ageOf(p.last_seen_at)}
                    </span>
                    <button onClick={() => unpair(p.peer_node_id)} className="lm-row__del" aria-label="Unpair" data-pulse="true" data-pulse-action="destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="lm-peer__grid">
                    <div>
                      <p className="lm-micro">Address</p>
                      <code className="lm-body" style={{ fontFamily: "ui-monospace,monospace", color: "hsl(0 0% 100% / 0.8)" }}>
                        {p.primary_addr || "—"}
                      </code>
                    </div>
                    <div>
                      <p className="lm-micro">Models</p>
                      <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.8)" }}>
                        {p.capabilities?.models?.length ? p.capabilities.models.slice(0, 3).map((m) => m.name).join(", ") : "(none)"}
                      </p>
                    </div>
                    <div>
                      <p className="lm-micro">Tools</p>
                      <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.8)" }}>
                        {p.capabilities?.tools?.length ? `${p.capabilities.tools.length} registered` : "(none)"}
                      </p>
                    </div>
                  </div>
                  <details className="lm-peer__policy">
                    <summary>Policy</summary>
                    <div className="mt-3 space-y-2">
                      <label className="lm-toggle">
                        <span>Allow this device to auto-approve our own actions</span>
                        <input
                          type="checkbox"
                          checked={p.policy.allow_self_actions}
                          onChange={(e) => togglePolicy(p, "allow_self_actions", e.target.checked)}
                        />
                      </label>
                      <label className="lm-toggle">
                        <span>Advertise our capabilities to this peer</span>
                        <input
                          type="checkbox"
                          checked={p.policy.advertise_capabilities}
                          onChange={(e) => togglePolicy(p, "advertise_capabilities", e.target.checked)}
                        />
                      </label>
                      <label className="lm-toggle">
                        <span>Sync conversations (shared chat history; each turn shows which device it came from)</span>
                        <input
                          type="checkbox"
                          checked={p.policy.sync_conversations !== false}
                          onChange={(e) => togglePolicy(p, "sync_conversations", e.target.checked)}
                        />
                      </label>
                      <label className="lm-toggle">
                        <span>Allow this peer to drive chat on us (remote execution)</span>
                        <input
                          type="checkbox"
                          checked={!!p.policy.accept_chat_relay}
                          onChange={(e) => togglePolicy(p, "accept_chat_relay", e.target.checked)}
                        />
                      </label>
                      <label className="lm-toggle">
                        <span>Accept workspace relay (git / coding worktrees on this machine)</span>
                        <input
                          type="checkbox"
                          checked={!!p.policy.accept_workspace_relay}
                          onChange={(e) => togglePolicy(p, "accept_workspace_relay", e.target.checked)}
                        />
                      </label>
                      <label className="lm-toggle">
                        <span>Accept tool relay (this peer&apos;s model can run files / calendar / mail / browser actions on this machine)</span>
                        <input
                          type="checkbox"
                          checked={!!p.policy.accept_tool_relay}
                          onChange={(e) => togglePolicy(p, "accept_tool_relay", e.target.checked)}
                        />
                      </label>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick links to deep surfaces */}
      <section>
        <p className="lm-micro mb-6">Capabilities</p>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          <CapCard href="/mcp"     Icon={Plug}    title="MCP servers"  hint="Plug in tools — Home Assistant, Penpot, n8n, Postgres, more." />
          <CapCard href="/models"  Icon={Box}     title="Models"       hint="Local Ollama models. Pull, swap, delete." />
          <CapCard href="/plugins" Icon={Package} title="Plugins"      hint="Marketplace + installed app extensions." />
        </div>
      </section>

      <style jsx>{`
        .lm-peer {
          padding: 18px 4px;
          border-bottom: 1px solid hsl(0 0% 100% / 0.06);
        }
        .lm-peer__head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .lm-peer__dot {
          width: 8px; height: 8px; border-radius: 9999px;
          background: hsl(0 0% 100% / 0.18);
        }
        .lm-peer__dot[data-online="true"] {
          background: hsl(0 0% 100%);
          box-shadow: 0 0 10px hsl(0 0% 100% / 0.6);
        }
        .lm-peer__name {
          font-size: 14px; letter-spacing: -0.005em;
          color: hsl(0 0% 100% / 0.96);
          background: none; border: none; padding: 0;
        }
        .lm-peer__name:hover { text-decoration: underline; }
        .lm-peer__grid {
          display: grid; gap: 14px; padding-left: 18px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }
        .lm-peer__policy {
          margin-top: 12px; padding-left: 18px;
          font-size: 12px; color: hsl(0 0% 100% / 0.5);
        }
        .lm-peer__policy summary { cursor: pointer; }
        .lm-peer__policy summary:hover { color: hsl(0 0% 100% / 0.8); }

        .lm-toggle {
          display: flex; align-items: center; justify-content: space-between;
          font-size: 12px;
          color: hsl(0 0% 100% / 0.75);
        }
        .lm-toggle input[type="checkbox"] {
          appearance: none;
          width: 32px; height: 18px;
          border-radius: 9999px;
          background: hsl(0 0% 100% / 0.10);
          border: 1px solid hsl(0 0% 100% / 0.14);
          position: relative;
          cursor: pointer;
          transition: background var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-toggle input[type="checkbox"]::after {
          content: ""; position: absolute; top: 2px; left: 2px;
          width: 12px; height: 12px;
          border-radius: 9999px;
          background: hsl(0 0% 100% / 0.6);
          transition: transform var(--lm-dur-micro) var(--lm-ease-micro), background var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-toggle input[type="checkbox"]:checked { background: hsl(0 0% 100% / 0.25); }
        .lm-toggle input[type="checkbox"]:checked::after { transform: translateX(14px); background: hsl(0 0% 100%); }
      `}</style>
    </div>
  );
}

function CapCard({ href, Icon, title, hint }:
  { href: string; Icon: React.ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <Link href={href} className="lm-cap" data-pulse="true">
      <span className="lm-cap__icon"><Icon className="h-4 w-4" /></span>
      <div className="flex-1">
        <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)" }}>{title}</p>
        <p className="lm-micro mt-1" style={{ textTransform: "none", letterSpacing: 0 }}>{hint}</p>
      </div>
      <ChevronRight className="h-4 w-4" style={{ color: "hsl(0 0% 100% / 0.3)" }} />
      <style jsx>{`
        .lm-cap {
          display: flex; align-items: center; gap: 12px;
          padding: 16px;
          background: hsl(0 0% 100% / 0.03);
          border: 1px solid hsl(0 0% 100% / 0.06);
          border-radius: 14px;
          transition: background var(--lm-dur-micro) var(--lm-ease-micro),
                      border-color var(--lm-dur-micro) var(--lm-ease-micro);
        }
        .lm-cap:hover { background: hsl(0 0% 100% / 0.06); border-color: hsl(0 0% 100% / 0.12); }
        .lm-cap__icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px;
          border-radius: 10px;
          background: hsl(0 0% 100% / 0.05);
          color: hsl(0 0% 100% / 0.8);
        }
      `}</style>
    </Link>
  );
}

function PairingPanel({ pairing, expiryRef, label, onLabelChange, onClose, onCopy }:
  { pairing: PairingStart; expiryRef: React.RefObject<HTMLSpanElement | null>; label: string;
    onLabelChange: (v: string) => void; onClose: () => void; onCopy: () => void }) {
  return (
    <div className="lm-surface-1 mb-6 p-5" style={{ borderRadius: 14, borderColor: "hsl(0 0% 100% / 0.2)" }}>
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="h-4 w-4" />
        <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)" }}>Pair a new device</p>
        <span ref={expiryRef} className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>…</span>
        <button onClick={onClose} className="lm-action lm-action--ghost ml-auto" data-pulse="true" style={{ padding: "4px 10px" }}>Close</button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="lm-micro mb-3">Scan from the other device</p>
          <div
            style={{ background: "white", padding: 8, borderRadius: 12, display: "inline-block" }}
            dangerouslySetInnerHTML={{ __html: pairing.qr_svg }}
          />
          <p className="lm-micro mt-3" style={{ textTransform: "none", letterSpacing: 0 }}>
            Token: <code style={{ fontFamily: "ui-monospace,monospace" }}>{pairing.window.token_short}…</code>
          </p>
        </div>
        <div className="space-y-3">
          <p className="lm-micro">Or paste this payload on the other device</p>
          <textarea
            rows={6}
            readOnly
            value={pairing.payload_json}
            className="lm-input"
            style={{ width: "100%", fontFamily: "ui-monospace,monospace", fontSize: 11 }}
          />
          <div className="flex gap-2">
            <button onClick={onCopy} className="lm-action lm-action--ghost" data-pulse="true">
              <Copy className="h-3.5 w-3.5" /> Copy payload
            </button>
          </div>
          <input
            placeholder="Label hint (optional)"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            className="lm-input w-full"
          />
        </div>
      </div>
    </div>
  );
}

function AcceptPanel({ payload, label, accepting, onPayloadChange, onLabelChange, onAccept, onClose }:
  { payload: string; label: string; accepting: boolean;
    onPayloadChange: (v: string) => void; onLabelChange: (v: string) => void;
    onAccept: () => void; onClose: () => void }) {
  return (
    <div className="lm-surface-1 mb-6 p-5 space-y-3" style={{ borderRadius: 14 }}>
      <div className="flex items-center gap-3">
        <ScanLine className="h-4 w-4" />
        <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)" }}>Accept a pairing invitation</p>
        <button onClick={onClose} className="lm-action lm-action--ghost ml-auto" data-pulse="true" style={{ padding: "4px 10px" }}>Close</button>
      </div>
      <p className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
        Paste the pairing payload from the other device — single-use, expires in 5 minutes.
      </p>
      <textarea
        rows={5}
        placeholder='{"v":1, "node_id":"...", ...}'
        value={payload}
        onChange={(e) => onPayloadChange(e.target.value)}
        className="lm-input"
        style={{ width: "100%", fontFamily: "ui-monospace,monospace", fontSize: 11 }}
      />
      <input
        placeholder="Label for that device (optional)"
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        className="lm-input w-full"
      />
      <button onClick={onAccept} disabled={accepting || !payload.trim()} className="lm-action" data-pulse="true">
        {accepting ? "Pairing…" : "Pair"}
      </button>
    </div>
  );
}
