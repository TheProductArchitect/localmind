"use client";
import { useEffect, useState } from "react";
import { Button, Card, Badge } from "@/components/ui";

type Tier = "allow" | "ask" | "pin";
type Profile = { id: string; name: string; tiers: Record<string, Tier>; builtin: number };

const ACTIONS = [
  "read_files", "write_files", "delete_files", "read_calendar", "write_calendar",
  "read_email", "send_email", "open_applications", "browser_automation",
  "pull_models", "delete_models", "change_settings", "export_data",
  "web_search", "memory_read", "memory_write",
];
const LABELS: Record<string, string> = {
  read_files: "Read files", write_files: "Write files", delete_files: "Delete files",
  read_calendar: "Read calendar", write_calendar: "Write calendar",
  read_email: "Read email", send_email: "Send email",
  open_applications: "Open applications", browser_automation: "Browser automation",
  pull_models: "Pull models", delete_models: "Delete models",
  change_settings: "Change settings", export_data: "Export data",
  web_search: "Web search", memory_read: "Read memory", memory_write: "Write memory",
};
const TIERS: { id: Tier; label: string }[] = [
  { id: "allow", label: "Always Allow" },
  { id: "ask", label: "Ask First" },
  { id: "pin", label: "Never Without PIN" },
];

export default function PermissionsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<string>("");

  async function load() {
    const r = await fetch("/api/permissions");
    const j = await r.json();
    setProfiles(j.profiles);
    setActive(j.active);
  }
  useEffect(() => { load(); }, []);

  const profile = profiles.find((p) => p.id === active);

  async function switchProfile(id: string) {
    setActive(id);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active_profile_id: id }),
    });
  }

  async function setTier(action: string, tier: Tier) {
    if (!profile) return;
    if (tier === "allow" && (action === "send_email" || action === "delete_files")) {
      if (!confirm(`Set "${LABELS[action]}" to Always Allow? The AI will perform this without asking you.`)) return;
    }
    const tiers = { ...profile.tiers, [action]: tier };
    setProfiles((ps) => ps.map((p) => (p.id === profile.id ? { ...p, tiers } : p)));
    await fetch("/api/permissions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: profile.id, tiers }),
    });
  }

  async function saveAsNew() {
    if (!profile) return;
    const name = prompt("Name for the new profile:");
    if (!name) return;
    const r = await fetch("/api/permissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, tiers: profile.tiers }),
    });
    const j = await r.json();
    if (j.profile) { await load(); switchProfile(j.profile.id); }
  }

  const risky = profile && profile.tiers.send_email === "allow";

  return (
    <div className="mx-auto max-w-5xl px-10 py-14">
      <div className="flex items-end justify-between gap-6 mb-10">
        <div>
          <p className="lm-micro mb-2">Permissions</p>
          <h1 className="lm-display">What Sora may do</h1>
        </div>
        {risky && <Badge variant="warning">Risky: Send email is Always Allow</Badge>}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => switchProfile(p.id)}
            className={`rounded-full px-3 py-1 text-sm border ${
              active === p.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            }`}
          >
            {p.name}
          </button>
        ))}
        <Button size="sm" variant="outline" onClick={saveAsNew}>Save as new profile</Button>
      </div>

      {profile && (
        <div className="grid gap-3 md:grid-cols-3">
          {TIERS.map((tier) => (
            <Card key={tier.id} className="p-3">
              <p className="font-medium text-sm mb-2">{tier.label}</p>
              <div className="space-y-1">
                {ACTIONS.filter((a) => profile.tiers[a] === tier.id).map((a) => (
                  <div key={a} className="rounded border bg-muted/30 px-2 py-1.5 text-sm">
                    <div>{LABELS[a]}</div>
                    <div className="flex gap-1 mt-1">
                      {TIERS.filter((t) => t.id !== tier.id).map((t) => (
                        <Button key={t.id} size="sm" variant="outline" className="h-6 text-xs px-2"
                          onClick={() => setTier(a, t.id)}>
                          → {t.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
                {ACTIONS.filter((a) => profile.tiers[a] === tier.id).length === 0 && (
                  <p className="text-xs text-muted-foreground">Nothing here.</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-4">
        Changes take effect immediately and are written to the audit log.
      </p>
    </div>
  );
}
