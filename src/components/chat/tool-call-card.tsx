"use client";
import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolCallState = {
  id: string;
  toolName: string;
  status: string;
  input?: any;
  result?: { status: string; output: string };
};

export function ToolCallCard({ tc }: { tc: ToolCallState }) {
  const [open, setOpen] = useState(false);
  const failed = tc.result?.status === "failed" || tc.result?.status === "denied";
  return (
    <div className={cn("my-2 rounded-md border text-sm", failed && "border-destructive")}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
        <Wrench className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{tc.toolName}</span>
        <span className={cn("ml-auto text-xs", failed ? "text-destructive" : "text-muted-foreground")}>
          {tc.result ? tc.result.status : tc.status}
        </span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-2 bg-muted/30">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Input</p>
            <pre className="text-xs overflow-x-auto">{JSON.stringify(tc.input, null, 2)}</pre>
          </div>
          {tc.result && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Output</p>
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap">{tc.result.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
