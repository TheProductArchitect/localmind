# DGX Spark hub over Wi‑Fi / LAN

Use a powerful box (e.g. NVIDIA DGX Spark) as the **compute hub** while each
personal PC keeps personal-assistant tools local (files, calendar, mail,
browser).

## Setup

1. **Same LAN.** Put the DGX and each PC on the same Wi‑Fi/subnet. The fleet
   listener binds `0.0.0.0:9443` (`LOCALMIND_FLEET_PORT`).
2. **AP client isolation.** Many consumer APs block peer-to-peer traffic.
   If pairing or heartbeats fail with `EHOSTUNREACH` to `:9443`, disable
   client/AP isolation (or use Ethernet / a VPN that bridges the hosts).
3. **Install** LocalMind + Ollama (+ openssl) on the DGX; pull large local
   models (e.g. `llama3.1:70b`). Clients can stay thin.
4. **Pair** each PC with the DGX via Fleet → QR. Pairing pins mTLS certs.
5. **On the DGX**, for each PC peer enable **Accept chat relay**.
6. **On each PC**, for the DGX peer enable **Accept tool relay** so the hub’s
   model may run allowlisted PA tools back on that PC.
7. **In chat** on the PC: Run on = DGX (or **Auto** — GPU-aware) and
   **Tools → On this device**.

Heartbeats advertise `primary_addr`; DHCP renumbers refresh
`fleet_peers.primary_addr` without re-pairing.

## What runs where

| Concern | Machine |
|---------|---------|
| Model + agent loop | DGX (or Auto → GPU peer) |
| Files / calendar / mail / browser / reminders / contacts / mac automation | Initiator PC (`tool_home=initiator`) |
| `shell` | Never over tool-relay |
| Git / coding workspace | Workspace-relay (separate path) |
| Destructive `ask` / `pin` confirms | Stream back to the initiating PC UI |

WAN/NAT and mDNS discovery are out of scope — use Tailscale/WireGuard if
hosts are not on one L2/L3 network.

See also: [mesh-depth-v4-implementation.md](./mesh-depth-v4-implementation.md).
