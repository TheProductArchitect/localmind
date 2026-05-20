// Minimal cron support: "min hour dom mon dow".

export function cronMatches(expr: string, date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fields = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  return parts.every((field, i) => matchField(field, fields[i]));
}

function matchField(field: string, value: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.startsWith("*/")) {
      if (value % Number(part.slice(2)) === 0) return true;
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (value >= a && value <= b) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

// Convert a natural-language schedule into a cron expression. Best-effort.
export function nlToCron(text: string): string {
  const t = text.toLowerCase().trim();
  const timeMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  let hour = 9;
  let minute = 0;
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
    if (timeMatch[3] === "pm" && hour < 12) hour += 12;
    if (timeMatch[3] === "am" && hour === 12) hour = 0;
  }
  if (/every hour|hourly/.test(t)) return "0 * * * *";
  if (/every (\d+) minutes?/.test(t)) {
    const n = t.match(/every (\d+) minutes?/)![1];
    return `*/${n} * * * *`;
  }
  if (/every minute/.test(t)) return "* * * * *";
  const days: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  };
  for (const [name, dow] of Object.entries(days)) {
    if (t.includes(name)) return `${minute} ${hour} * * ${dow}`;
  }
  if (/weekday/.test(t)) return `${minute} ${hour} * * 1-5`;
  if (/every day|daily|each (morning|day|evening)|morning|evening/.test(t))
    return `${minute} ${hour} * * *`;
  if (/every week|weekly/.test(t)) return `${minute} ${hour} * * 1`;
  // Default: daily at the parsed time.
  return `${minute} ${hour} * * *`;
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, , , dow] = parts;
  if (min.startsWith("*/")) return `every ${min.slice(2)} minutes`;
  if (hour === "*") return `every hour at :${min.padStart(2, "0")}`;
  const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dow === "*") return `daily at ${time}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (dow === "1-5") return `weekdays at ${time}`;
  return `${names[Number(dow)] || dow} at ${time}`;
}
