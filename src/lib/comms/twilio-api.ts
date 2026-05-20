import { getChannel } from "../db/channels";

function creds() {
  const { config } = getChannel("twilio");
  return { sid: config.accountSid as string, token: config.authToken as string, from: config.phoneNumber as string };
}

function authHeader(sid: string, token: string) {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

// Verifies the Twilio account credentials.
export async function verifyTwilioCreds(sid: string, token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: authHeader(sid, token) },
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, error: (j as any).message || `Twilio returned HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Could not reach Twilio" };
  }
}

export async function sendSms(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const { sid, token, from } = creds();
  if (!sid || !token || !from) return { ok: false, error: "Twilio is not fully configured." };
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: authHeader(sid, token), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, error: (j as any).message || `HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

export async function makeCall(to: string, twimlUrl: string): Promise<{ ok: boolean; error?: string }> {
  const { sid, token, from } = creds();
  if (!sid || !token || !from) return { ok: false, error: "Twilio is not fully configured." };
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: authHeader(sid, token), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Url: twimlUrl }),
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, error: (j as any).message || `HTTP ${r.status}` };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}

// Tracks the most recent inbound message per channel for wizard verification.
const lastInbound: Record<string, { from: string; body: string; at: number }> = {};
export function recordInbound(channel: string, from: string, body: string) {
  lastInbound[channel] = { from, body, at: Date.now() };
}
export function getLastInbound(channel: string) {
  return lastInbound[channel] || null;
}
