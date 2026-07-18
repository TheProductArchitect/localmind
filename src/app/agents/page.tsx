"use client";

/**
 * /agents — the agent visibility surface.
 *
 * Three stacked views, polled every ~3s so it feels live:
 *
 *   1. LIVE       — running subagents (and the parent processes that spawned
 *                   them). Each is a card with its own mini-orb, role, elapsed
 *                   time, and the tool surface the parent granted it. Cards
 *                   slide in as Sora spawns and dissolve as they finish.
 *
 *   2. PERSONAS   — the persona templates Sora can use as the base for a
 *                   spawned agent (General, DevPM, plus any custom ones).
 *                   Each shows its description and the default tools it
 *                   carries unless the spawn call narrows them.
 *
 *   3. RECENT     — last 50 finished subagents, grouped by the role
 *                   description the parent gave them. Surfaces the variety
 *                   of agent profiles Sora has been creating without any
 *                   manual catalog work.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Orb } from "@/components/orb";
import { Workflow, Sparkles, History, BookOpen, CheckCircle2, XCircle } from "lucide-react";
import { HowItWorks } from "@/components/how-it-works";

type Proc = {
  process_id: string;
  process_type: string;
  display_name: string;
  agent_name: string | null;
  persona_id: string | null;
  started_at: number;
  completed_at: number | null;
  status: string;
  current_step: string | null;
  metadata_json: string;
};

type Persona = {
  persona_id: string;
  name: string;
  description: string | null;
  enabled_tools: string;
};

type AgentMemoryEntry = {
  memory_id: string;
  persona_id: string;
  kind: "lesson" | "warning" | "preference" | "fact";
  content: string;
  status: "committed" | "proposed" | "retired";
  created_by: "user" | "sora" | "system";
  confidence: number;
  created_at: number;
};

type MemoryByPersona = Record<string, AgentMemoryEntry[]>;

function elapsed(ms: number): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 1000) return "now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ${Math.floor((d % 60_000) / 1000)}s`;
  return `${Math.floor(d / 3_600_000)}h ${Math.floor((d % 3_600_000) / 60_000)}m`;
}

function isSubagent(p: Proc): boolean {
  return (p.display_name || "").toLowerCase().includes("subagent");
}

function metaTools(p: Proc): string[] {
  try {
    const m = JSON.parse(p.metadata_json || "{}") as { allowed_tools?: string[]; tools?: string[] };
    return m.allowed_tools || m.tools || [];
  } catch { return []; }
}

function metaGoal(p: Proc): string | null {
  try {
    const m = JSON.parse(p.metadata_json || "{}") as { goal?: string; role?: string; prompt?: string };
    return m.goal || m.role || m.prompt || null;
  } catch { return null; }
}

/** Model the spawn is/was running. Tagged into metadata at startProcess time. */
function metaModel(p: Proc): string | null {
  try {
    const m = JSON.parse(p.metadata_json || "{}") as { model?: string };
    return m.model || null;
  } catch { return null; }
}

export default function AgentsPage() {
  const [active, setActive] = useState<Proc[]>([]);
  const [history, setHistory] = useState<Proc[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [memory, setMemory] = useState<MemoryByPersona>({});
  // Sora's own active model — fetched alongside everything else so the header
  // can show "Sora → llama3.1:8b" without each user inferring it from settings.
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // ticks once per second so elapsed times animate
  const tickRef = useRef<number | null>(null);

  async function load() {
    try {
      const [a, h, p, s] = await Promise.all([
        fetch("/api/orchestration/processes").then((r) => r.json()).catch(() => ({ processes: [] })),
        fetch("/api/orchestration/processes?history=1").then((r) => r.json()).catch(() => ({ processes: [] })),
        fetch("/api/agent/personas").then((r) => r.json()).catch(() => ({ personas: [] })),
        fetch("/api/settings").then((r) => r.json()).catch(() => ({ settings: {} })),
      ]);
      setActiveModel((s.settings?.active_model as string) || null);
      setActive((a.processes as Proc[]) || []);
      setHistory((h.processes as Proc[]) || []);
      const personaList = (p.personas as Persona[]) || [];
      setPersonas(personaList);
      // Per-persona memory in one fan-out. Cheap (small payloads) and lets
      // each row render its lessons without N waterfalls.
      const mem: MemoryByPersona = {};
      await Promise.all(personaList.map(async (persona) => {
        try {
          const r = await fetch(`/api/agent/memory/${persona.persona_id}`).then((x) => x.json());
          mem[persona.persona_id] = (r.items as AgentMemoryEntry[]) || [];
        } catch { mem[persona.persona_id] = []; }
      }));
      setMemory(mem);
    } catch { /* keep last good state */ }
  }

  async function promoteMemory(personaId: string, memoryId: string) {
    await fetch(`/api/agent/memory/${personaId}?id=${memoryId}`, { method: "PATCH" });
    load();
  }
  async function retireMemoryEntry(personaId: string, memoryId: string) {
    await fetch(`/api/agent/memory/${personaId}?id=${memoryId}`, { method: "DELETE" });
    load();
  }
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);
  useEffect(() => {
    tickRef.current = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  // Live: subagent-shaped active processes first, then parents.
  const liveSubagents = useMemo(() => active.filter(isSubagent), [active]);
  const liveParents = useMemo(() => active.filter((p) => !isSubagent(p)), [active]);

  // Recent: bucket finished subagents by role/goal so similar agents collapse
  // into a "profile" the user can read.
  type Profile = { role: string; count: number; lastAt: number; durations: number[]; sample: Proc };
  const profiles = useMemo<Profile[]>(() => {
    const subs = history.filter(isSubagent);
    const byRole = new Map<string, Profile>();
    for (const p of subs) {
      const role = (metaGoal(p) || p.display_name || "(unnamed)").slice(0, 80);
      const dur = p.completed_at && p.started_at ? p.completed_at - p.started_at : 0;
      const cur = byRole.get(role);
      if (cur) {
        cur.count += 1;
        cur.lastAt = Math.max(cur.lastAt, p.started_at);
        cur.durations.push(dur);
      } else {
        byRole.set(role, { role, count: 1, lastAt: p.started_at, durations: [dur], sample: p });
      }
    }
    return Array.from(byRole.values()).sort((a, b) => b.lastAt - a.lastAt).slice(0, 20);
  }, [history]);

  return (
    <div className="mx-auto max-w-5xl px-10 py-14">
      <header className="mb-10 flex items-end justify-between">
        <div>
          <p className="lm-micro mb-2">Agents</p>
          <h1 className="lm-display">Who Sora has called on</h1>
          <p className="lm-body mt-3 max-w-xl" style={{ color: "hsl(0 0% 100% / 0.55)" }}>
            Live view of every subagent Sora has spawned, the personas she uses as templates,
            and the variety of roles she&apos;s created recently.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Orb state={liveSubagents.length > 0 ? "spawn" : active.length > 0 ? "thinking" : "idle"} size={32} satellites={Math.max(1, Math.min(liveSubagents.length, 6))} />
          <div className="lm-body" style={{ color: "hsl(0 0% 100% / 0.85)", fontSize: 12 }}>
            <div>{liveSubagents.length} subagent{liveSubagents.length === 1 ? "" : "s"} live</div>
            <div className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
              {liveParents.length} parent process{liveParents.length === 1 ? "" : "es"}
            </div>
            {activeModel && (
              <div className="lm-micro mt-1" style={{
                textTransform: "none", letterSpacing: 0,
                color: "hsl(0 0% 100% / 0.55)",
                fontFamily: "ui-monospace,monospace", fontSize: 10,
              }}>
                Sora → {activeModel}
              </div>
            )}
          </div>
        </div>
      </header>

      <HowItWorks
        title="How agents spawn"
        bullets={[
          { title: "Sora summons.", body: "When a task needs specialised work, Sora picks a persona (Writer, Coder, Researcher, …) and calls spawn_subagent with a focused goal." },
          { title: "Narrow tool surface.", body: "Each persona has its own enabled_tools list — Writer can't touch the filesystem, Researcher can't send mail. Sora's request narrows further. The engine enforces the whitelist; tools outside it are hidden and refused at dispatch." },
          { title: "Subagents can ask for more.", body: "If a subagent gets stuck because its surface is too narrow, it calls request_tool_access with a reason. The run ends cleanly with a structured request; Sora decides whether to re-spawn with broader access, do the work herself, or tell you we can't proceed." },
          { title: "Sora orchestrates the follow-up.", body: "After a subagent returns, Sora reads the output, synthesizes across multiple subagents if she ran them in parallel, and takes follow-up action when results demand it — never just pastes raw output." },
          { title: "Safety stays intact.", body: "Subagents inherit the destructive-action floor: even in auto mode they cannot delete files, drop tables, send email, or run rm-style commands without your inline sign-off. Tool outputs from web/email/peers are wrapped in untrusted-content envelopes so injection text can't issue instructions to them either." },
        ]}
      />

      <div className="mb-8" />

      {/* === Live === */}
      <section className="mb-14">
        <div className="flex items-center justify-between mb-3">
          <p className="lm-micro">Live</p>
          <p className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.35)" }}>
            Updates every ~3s
          </p>
        </div>
        {liveSubagents.length === 0 && liveParents.length === 0 ? (
          <p className="lm-body py-10 text-center" style={{ color: "hsl(0 0% 100% / 0.35)" }}>
            No agents running right now. Sora spawns subagents when she decides to fan work out.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Subagents render with the spawn-state mini-orb */}
            {liveSubagents.map((p) => (
              <AgentCard key={p.process_id} proc={p} kind="subagent" tick={tick} />
            ))}
            {/* Parents render with thinking-state */}
            {liveParents.map((p) => (
              <AgentCard key={p.process_id} proc={p} kind="parent" tick={tick} />
            ))}
          </div>
        )}
      </section>

      {/* === Personas === */}
      <section className="mb-14">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-3.5 w-3.5" style={{ color: "hsl(0 0% 100% / 0.5)" }} />
          <p className="lm-micro">Persona templates</p>
        </div>
        {personas.length === 0 ? (
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>Loading…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {personas.map((p) => {
              let tools: string[] = [];
              try { tools = JSON.parse(p.enabled_tools || "[]"); } catch {}
              return (
                <div key={p.persona_id} className="lm-agent-card" data-static="true">
                  <div className="flex items-start gap-3">
                    <Orb state="idle" size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)", fontWeight: 500 }}>{p.name}</p>
                      {p.description && (
                        <p className="lm-micro mt-1" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.55)" }}>
                          {p.description}
                        </p>
                      )}
                    </div>
                  </div>
                  {tools.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {tools.slice(0, 6).map((t) => (
                        <span key={t} className="lm-chip" style={{ fontFamily: "ui-monospace,monospace" }}>{t}</span>
                      ))}
                      {tools.length > 6 && <span className="lm-chip">+{tools.length - 6}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* === Memory === */}
      <section className="mb-14">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-3.5 w-3.5" style={{ color: "hsl(0 0% 100% / 0.5)" }} />
          <p className="lm-micro">Lessons learned</p>
        </div>
        <HowItWorks
          title="How agent memory works"
          bullets={[
            { title: "Agents read, they don't write.", body: "Each persona has its own memory. At spawn time, committed lessons are injected into the subagent's system prefix as a read-only block. Subagents cannot edit or add to it — preventing a sub-persona from rationalizing a bad pattern into its own doctrine." },
            { title: "Three writers, by design.", body: "You (via this page), Sora (via the agent_memory tool when she observes a pattern across runs), and the critic (the watchdog) are the only writers. Critic findings land as 'proposed' for you or Sora to review before they become 'committed'." },
            { title: "The critic watches selectively.", body: "Running a judge on every subagent would be wasteful. The watchdog reviews hard failures always, slow runs (>1.5× p95) sometimes, and samples 10% of successes — enough to learn without doubling cost." },
            { title: "Auto-commit only on ground truth.", body: "High-confidence critic findings on real failures auto-commit. Everything else (sampling, slow-run reviews, low-confidence) lands as 'proposed' so a human or Sora confirms before it shapes future behavior." },
            { title: "Retire is soft.", body: "Retiring a lesson keeps the row for audit so you can see what guidance was once active. The next spawn no longer injects it." },
          ]}
        />
        <div className="mt-4 space-y-3">
          {personas.map((persona) => {
            const items = memory[persona.persona_id] || [];
            const committed = items.filter((m) => m.status === "committed");
            const proposed = items.filter((m) => m.status === "proposed");
            if (committed.length === 0 && proposed.length === 0) return null;
            return (
              <div key={persona.persona_id} className="lm-agent-card" data-static="true">
                <div className="flex items-center justify-between mb-2">
                  <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)", fontWeight: 500 }}>{persona.name}</p>
                  <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.4)" }}>
                    {committed.length} committed{proposed.length > 0 && ` · ${proposed.length} proposed`}
                  </span>
                </div>
                {committed.map((m) => (
                  <div key={m.memory_id} className="flex items-start gap-2 mt-1.5">
                    <span style={{ color: "hsl(0 0% 100% / 0.5)", flexShrink: 0, fontFamily: "ui-monospace,monospace", fontSize: 11, lineHeight: "1.4" }}>
                      {m.kind === "warning" ? "⚠" : m.kind === "preference" ? "•" : m.kind === "fact" ? "ⓘ" : "✓"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.88)", fontSize: 13 }}>{m.content}</p>
                      <p className="lm-micro mt-0.5" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.35)" }}>
                        by {m.created_by}
                      </p>
                    </div>
                    <button
                      onClick={() => retireMemoryEntry(persona.persona_id, m.memory_id)}
                      className="lm-micro"
                      style={{ color: "hsl(0 0% 100% / 0.4)", textTransform: "none", letterSpacing: 0, background: "transparent", border: 0, cursor: "pointer" }}
                      title="Retire this lesson"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {proposed.length > 0 && (
                  <>
                    <p className="lm-micro mt-3 mb-1" style={{ color: "hsl(0 0% 100% / 0.5)" }}>Proposed by critic</p>
                    {proposed.map((m) => (
                      <div key={m.memory_id} className="flex items-start gap-2 mt-1.5" style={{ opacity: 0.85 }}>
                        <span style={{ color: "hsl(40 90% 60% / 0.8)", flexShrink: 0, fontFamily: "ui-monospace,monospace", fontSize: 11 }}>?</span>
                        <div className="flex-1 min-w-0">
                          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.78)", fontSize: 13 }}>{m.content}</p>
                          <p className="lm-micro mt-0.5" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.35)" }}>
                            critic · confidence {Math.round(m.confidence * 100)}%
                          </p>
                        </div>
                        <button
                          onClick={() => promoteMemory(persona.persona_id, m.memory_id)}
                          className="lm-micro"
                          style={{ color: "hsl(120 40% 70%)", textTransform: "none", letterSpacing: 0, background: "transparent", border: 0, cursor: "pointer" }}
                          title="Promote to committed"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => retireMemoryEntry(persona.persona_id, m.memory_id)}
                          className="lm-micro"
                          style={{ color: "hsl(0 0% 100% / 0.4)", textTransform: "none", letterSpacing: 0, background: "transparent", border: 0, cursor: "pointer" }}
                          title="Discard"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
          {Object.values(memory).every((items) => items.length === 0) && (
            <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
              No lessons yet. Sora will record them as patterns emerge; the critic will propose more after reviewing subagent runs.
            </p>
          )}
        </div>
      </section>

      {/* === Recent === */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <History className="h-3.5 w-3.5" style={{ color: "hsl(0 0% 100% / 0.5)" }} />
          <p className="lm-micro">Recent agent profiles</p>
        </div>
        {profiles.length === 0 ? (
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.4)" }}>
            Nothing yet — Sora hasn&apos;t spawned subagents in the recent history.
          </p>
        ) : (
          profiles.map((prof) => {
            const avg = prof.durations.filter((d) => d > 0);
            const avgMs = avg.length ? Math.round(avg.reduce((a, b) => a + b, 0) / avg.length) : 0;
            const tools = metaTools(prof.sample);
            return (
              <div key={prof.role} className="lm-agent-row">
                <Workflow className="h-3.5 w-3.5" style={{ color: "hsl(0 0% 100% / 0.4)", flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.92)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{prof.role}</p>
                  <p className="lm-micro mt-0.5" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.45)" }}>
                    {prof.count} spawn{prof.count === 1 ? "" : "s"}
                    {avgMs > 0 && ` · avg ${(avgMs / 1000).toFixed(1)}s`}
                    {tools.length > 0 && ` · ${tools.length} tool${tools.length === 1 ? "" : "s"}`}
                  </p>
                </div>
                <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0, color: "hsl(0 0% 100% / 0.4)" }}>
                  {elapsed(prof.lastAt)} ago
                </span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function AgentCard({ proc, kind, tick }: { proc: Proc; kind: "subagent" | "parent"; tick: number }) {
  // tick re-renders the card once per second so the elapsed clock counts up
  // even though `proc` itself only refreshes every ~3s.
  void tick;
  const tools = metaTools(proc);
  const goal = metaGoal(proc) || proc.current_step || proc.display_name;
  const model = metaModel(proc);
  return (
    <div className="lm-agent-card lm-agent-card--enter" data-status={proc.status}>
      <div className="flex items-start gap-3">
        <Orb state={kind === "subagent" ? "thinking" : "thinking"} size={28} />
        <div className="flex-1 min-w-0">
          <p className="lm-body" style={{ color: "hsl(0 0% 100% / 0.96)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {goal}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
              {elapsed(proc.started_at)} elapsed
            </span>
            <span className="lm-chip" data-tone={proc.status === "running" ? "ok" : undefined}>
              {proc.status}
            </span>
            {kind === "subagent" && <span className="lm-micro" style={{ textTransform: "none", letterSpacing: 0 }}>subagent</span>}
            {model && (
              <span
                className="lm-chip"
                style={{ fontFamily: "ui-monospace,monospace", fontSize: 10 }}
                title={`Model driving this agent: ${model}`}
              >
                {model}
              </span>
            )}
          </div>
        </div>
      </div>
      {tools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {tools.slice(0, 5).map((t) => (
            <span key={t} className="lm-chip" style={{ fontFamily: "ui-monospace,monospace" }}>{t}</span>
          ))}
          {tools.length > 5 && <span className="lm-chip">+{tools.length - 5}</span>}
        </div>
      )}
    </div>
  );
}
