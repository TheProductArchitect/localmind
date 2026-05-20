import crypto from "crypto";

// Twilio request signature validation (SHA-1 HMAC of URL + sorted params).
export function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken || !signature) return false;
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;
}

// Splits a long reply into SMS-sized segments with continuation markers.
export function splitSms(text: string, limit = 1500): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  let n = 1;
  while (rest.length) {
    parts.push(`(${n}) ` + rest.slice(0, limit));
    rest = rest.slice(limit);
    n++;
  }
  return parts;
}
