"use client";

/**
 * /projects — coding projects + undoable worktree sessions.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onActivate } from "@/lib/client/keyboard";
import { useConfirm } from "@/components/confirm-dialog";
import { FolderGit2, Plus, Play, ExternalLink, RotateCcw } from "lucide-react";

type Project = {
  id: string;
  name: string;
  repo_path: string;
  default_branch: string;
  remote_url: string | null;
  github_owner: string | null;
  github_repo: string | null;
};

type Session = {
  id: string;
  project_id: string;
  branch: string;
  worktree_path: string;
  status: string;
  goal: string;
  process_id: string | null;
  pr_url: string | null;
  graph_id: string | null;
  created_at: number;
};

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="p-10 lm-body" style={{ color: "hsl(0 0% 100% / 0.5)" }}>Loading…</div>}>
      <ProjectsPageInner />
    </Suspense>
  );
}

function ProjectsPageInner() {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [repoPath, setRepoPath] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [codeServer, setCodeServer] = useState<{ enabled: boolean; url: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/coding/projects");
    if (!r.ok) return;
    const j = await r.json();
    setProjects(j.projects || []);
    setSessions(j.sessions || []);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        const s = j.settings || {};
        setCodeServer({
          enabled: !!s.code_server_enabled,
          url: s.code_server_url || "http://127.0.0.1:8080",
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const pid = searchParams.get("project");
    if (pid) setSelectedProject(pid);
    if (searchParams.get("focus") === "1") {
      try {
        document.getElementById("lm-projects-sessions")?.scrollIntoView({ behavior: "smooth" });
      } catch { /* */ }
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedProject && projects[0]) setSelectedProject(projects[0].id);
  }, [projects, selectedProject]);

  async function register() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch("/api/coding/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "register", repo_path: repoPath, name: name || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Register failed");
      setRepoPath("");
      setName("");
      setMsg(`Registered ${j.project.name}`);
      setSelectedProject(j.project.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startSession() {
    if (!selectedProject || !goal.trim()) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fetch("/api/coding/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "start",
          project_id: selectedProject,
          goal: goal.trim(),
          run_swe: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Start failed");
      setGoal("");
      setMsg(`Session ${j.session.id} on ${j.session.branch}` + (j.graph_id ? ` · graph ${j.graph_id}` : ""));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function discard(sessionId: string) {
    const ok = await confirm({
      title: "Discard this session?",
      message: "Worktree and branch will be deleted (undo).",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/coding/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "discard", session_id: sessionId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Discard failed");
      setMsg("Session discarded");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openCodingWindow(projectId: string) {
    try {
      const r = await fetch("/api/coding/open-window", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const j = await r.json().catch(() => ({}));
      // Electron listens via signal file; in browser, prefer code-server when enabled.
      if (j.code_server_enabled && j.code_server_url) {
        window.open(j.code_server_url, "localmind-coding", "noopener,width=1200,height=800");
        return;
      }
      window.open(`/projects?project=${projectId}&focus=1`, "localmind-coding", "noopener,width=1200,height=800");
    } catch {
      window.open(`/projects?project=${projectId}`, "_blank");
    }
  }

  const projectSessions = sessions.filter((s) =>
    selectedProject ? s.project_id === selectedProject : true
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-10">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <FolderGit2 className="h-6 w-6 opacity-80" />
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        </div>
        <p className="text-sm opacity-60 max-w-2xl">
          Register a git repo under your approved folders. Each coding session gets an isolated
          worktree — discard undoes everything. Agents plan, implement, test, and open a PR on a
          feature branch (never main).
        </p>
        {codeServer?.enabled && (
          <p className="text-sm opacity-70 max-w-2xl border px-3 py-2" style={{ borderColor: "hsl(0 0% 100% / 0.12)" }}>
            code-server is enabled — the Electron coding window opens{" "}
            <a href={codeServer.url} target="_blank" rel="noreferrer" className="underline">
              {codeServer.url}
            </a>{" "}
            instead of this page. Toggle under Settings → General.
          </p>
        )}
      </header>

      {(error || msg) && (
        <div
          className="text-sm px-4 py-3 border"
          style={{
            borderColor: error ? "hsl(0 80% 50% / 0.4)" : "hsl(0 0% 100% / 0.12)",
            color: error ? "hsl(0 90% 70%)" : "hsl(0 0% 100% / 0.7)",
          }}
        >
          {error || msg}
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-widest opacity-50">Register project</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 bg-transparent border px-3 py-2 text-sm"
            style={{ borderColor: "hsl(0 0% 100% / 0.12)" }}
            placeholder="Absolute path to git repo (must be approved)"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
          />
          <input
            className="sm:w-40 bg-transparent border px-3 py-2 text-sm"
            style={{ borderColor: "hsl(0 0% 100% / 0.12)" }}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !repoPath.trim()}
            onClick={register}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border"
            style={{ borderColor: "hsl(0 0% 100% / 0.2)" }}
          >
            <Plus className="h-4 w-4" /> Register
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-widest opacity-50">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm opacity-50">No projects yet.</p>
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 px-3 py-3 border cursor-pointer"
                style={{
                  borderColor:
                    selectedProject === p.id ? "hsl(0 0% 100% / 0.35)" : "hsl(0 0% 100% / 0.1)",
                  background: selectedProject === p.id ? "hsl(0 0% 100% / 0.04)" : "transparent",
                }}
                onClick={() => setSelectedProject(p.id)}
                onKeyDown={onActivate(() => setSelectedProject(p.id))}
                role="button"
                tabIndex={0}
                aria-current={selectedProject === p.id || undefined}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs opacity-50 truncate font-mono">{p.repo_path}</div>
                  <div className="text-xs opacity-40 mt-1">
                    base {p.default_branch}
                    {p.github_owner ? ` · ${p.github_owner}/${p.github_repo}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-xs px-2 py-1 border opacity-70"
                  style={{ borderColor: "hsl(0 0% 100% / 0.15)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openCodingWindow(p.id);
                  }}
                >
                  Open window
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm uppercase tracking-widest opacity-50">Start session</h2>
        <textarea
          className="w-full bg-transparent border px-3 py-2 text-sm min-h-[80px]"
          style={{ borderColor: "hsl(0 0% 100% / 0.12)" }}
          placeholder="Goal for the coding agents (e.g. Add rate limiting to the login API)"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !selectedProject || !goal.trim()}
          onClick={startSession}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border"
          style={{ borderColor: "hsl(0 0% 100% / 0.2)" }}
        >
          <Play className="h-4 w-4" /> Start SWE session
        </button>
      </section>

      <section id="lm-projects-sessions" className="space-y-4">
        <h2 className="text-sm uppercase tracking-widest opacity-50">Sessions</h2>
        {projectSessions.length === 0 ? (
          <p className="text-sm opacity-50">No sessions.</p>
        ) : (
          <ul className="space-y-3">
            {projectSessions.map((s) => (
              <li
                key={s.id}
                className="border px-4 py-3 space-y-2"
                style={{ borderColor: "hsl(0 0% 100% / 0.1)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-wider opacity-40">{s.status}</div>
                    <div className="font-medium">{s.goal.slice(0, 120)}</div>
                    <div className="text-xs font-mono opacity-50 mt-1">{s.branch}</div>
                    <div className="text-xs font-mono opacity-40 truncate">{s.worktree_path}</div>
                  </div>
                  <div className="flex gap-2">
                    {s.pr_url && (
                      <a
                        href={s.pr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 border"
                        style={{ borderColor: "hsl(0 0% 100% / 0.15)" }}
                      >
                        <ExternalLink className="h-3 w-3" /> PR
                      </a>
                    )}
                    {s.status !== "discarded" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => discard(s.id)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 border"
                        style={{ borderColor: "hsl(0 70% 50% / 0.35)", color: "hsl(0 80% 70%)" }}
                      >
                        <RotateCcw className="h-3 w-3" /> Discard
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
