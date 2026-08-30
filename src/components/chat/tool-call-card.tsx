"use client";
import { useEffect, useState } from "react";
import { ChevronRight, Wrench, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolCallState = {
  id: string;
  toolName: string;
  status: string;
  input?: any;
  result?: { status: string; output: string; summary?: string };
};

type SpawnMeta = {
  kind?: string;
  conversation_id?: string;
  persona?: string | null;
  persona_id?: string;
  depth?: number;
  goal?: string;
  allowed_tools?: string[];
  timed_out?: boolean;
};

type ChildTool = {
  id: string;
  toolName: string;
  status: string;
  input?: unknown;
  output?: string;
};

function parseSpawnMeta(summary?: string): SpawnMeta | null {
  if (!summary) return null;
  try {
    const j = JSON.parse(summary);
    if (j && (j.kind === "subagent" || j.conversation_id)) return j as SpawnMeta;
  } catch {
    /* plain-text summaries from older builds */
  }
  return null;
}

function highLevelLabel(tc: ToolCallState, meta: SpawnMeta | null): string {
  if (tc.toolName.startsWith("spawn_subagent")) {
    const persona = meta?.persona || tc.input?.persona_id || "subagent";
    const goal = String(meta?.goal || tc.input?.goal || "").slice(0, 80);
    return goal ? `${persona} — ${goal}` : String(persona);
  }
  return tc.toolName;
}

export function ToolCallCard({ tc }: { tc: ToolCallState }) {
  const [open, setOpen] = useState(false);
  const [deepOpen, setDeepOpen] = useState(false);
  const [childTools, setChildTools] = useState<ChildTool[] | null>(null);
  const [childLoading, setChildLoading] = useState(false);

  const meta = parseSpawnMeta(tc.result?.summary);
  const isSpawn = tc.toolName.startsWith("spawn_subagent");
  const failed = tc.result?.status === "failed" || tc.result?.status === "denied";
  const label = highLevelLabel(tc, meta);

  useEffect(() => {
    if (!deepOpen || !meta?.conversation_id || childTools !== null) return;
    let cancelled = false;
    setChildLoading(true);
    fetch(`/api/conversations/${meta.conversation_id}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const msgs = (j.messages || []) as Array<{ id: string; role: string; content: string }>;
        const tools: ChildTool[] = [];
        for (const m of msgs) {
          if (m.role !== "tool") continue;
          try {
            const body = JSON.parse(m.content);
            tools.push({
              id: m.id,
              toolName: body.name || body.tool_name || "tool",
              status: body.status || "allowed",
              input: body.input,
              output: body.output || body.output_summary,
            });
          } catch {
            tools.push({ id: m.id, toolName: "tool", status: "ok", output: m.content.slice(0, 500) });
          }
        }
        setChildTools(tools);
      })
      .catch(() => setChildTools([]))
      .finally(() => { if (!cancelled) setChildLoading(false); });
    return () => { cancelled = true; };
  }, [deepOpen, meta?.conversation_id, childTools]);

  return (
    <div className={cn("my-1.5 rounded-md border text-[13px]", failed && "border-destructive")}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        {isSpawn ? (
          <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium truncate">{label}</span>
        <span className={cn("ml-auto text-[11px] shrink-0", failed ? "text-destructive" : "text-muted-foreground")}>
          {tc.result ? tc.result.status : tc.status}
        </span>
      </button>
      {open && (
        <div className="border-t px-2.5 py-1.5 space-y-1.5 bg-muted/30">
          {isSpawn && meta && (
            <div className="text-xs space-y-1">
              <p>
                <span className="text-muted-foreground">Agent </span>
                <span className="font-medium">{meta.persona || meta.persona_id || "subagent"}</span>
                {meta.depth != null && (
                  <span className="text-muted-foreground"> · depth {meta.depth}</span>
                )}
              </p>
              {meta.goal && <p className="text-muted-foreground">Goal: {meta.goal}</p>}
              {meta.allowed_tools && meta.allowed_tools.length > 0 && (
                <p className="text-muted-foreground">
                  Tools: {meta.allowed_tools.join(", ")}
                </p>
              )}
            </div>
          )}

          {!isSpawn && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Input</p>
              <pre className="text-xs overflow-x-auto">{JSON.stringify(tc.input, null, 2)}</pre>
            </div>
          )}

          {tc.result && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {isSpawn ? "Result" : "Output"}
              </p>
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {tc.result.output}
              </pre>
            </div>
          )}

          {isSpawn && meta?.conversation_id && (
            <div className="pt-1 border-t border-border/50">
              <button
                type="button"
                onClick={() => setDeepOpen((o) => !o)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", deepOpen && "rotate-90")} />
                {deepOpen ? "Hide tool details" : "Show what this agent did"}
              </button>
              {deepOpen && (
                <div className="mt-2 space-y-2">
                  {childLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
                  {!childLoading && childTools && childTools.length === 0 && (
                    <p className="text-xs text-muted-foreground">No tool calls recorded for this subagent.</p>
                  )}
                  {childTools?.map((ct) => (
                    <details key={ct.id} className="rounded border bg-background/50 px-2 py-1.5">
                      <summary className="cursor-pointer text-xs font-medium list-none flex items-center gap-2">
                        <Wrench className="h-3 w-3 text-muted-foreground" />
                        <span>{ct.toolName}</span>
                        <span className="ml-auto text-muted-foreground">{ct.status}</span>
                      </summary>
                      <div className="mt-1.5 space-y-1">
                        {ct.input !== undefined && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Input</p>
                            <pre className="text-xs overflow-x-auto">{JSON.stringify(ct.input, null, 2)}</pre>
                          </div>
                        )}
                        {ct.output && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Output</p>
                            <pre className="text-xs overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                              {ct.output}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}

          {isSpawn && !meta && tc.input && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Input</p>
              <pre className="text-xs overflow-x-auto">{JSON.stringify(tc.input, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
