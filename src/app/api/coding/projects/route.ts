/**
 * REST API for coding projects + sessions.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth/identity";
import {
  createCodingProject,
  deleteCodingProject,
  getCodingProject,
  listCodingProjects,
  listCodingSessions,
} from "@/lib/db/coding";
import {
  createWorktreeSession,
  discardWorktreeSession,
  detectDefaultBranch,
  detectRemoteUrl,
  expandHome,
  parseGithubRemote,
  pathUnderApproved,
} from "@/lib/coding/worktree";
import { startSweLoop } from "@/lib/coding/swe-graph";
import { getSettings } from "@/lib/db/queries";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

function approved(): string[] {
  try {
    return JSON.parse(getSettings().approved_dirs || "[]") as string[];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const projects = listCodingProjects();
  const sessions = listCodingSessions();
  return NextResponse.json({ projects, sessions });
}

const Register = z.object({
  name: z.string().min(1).max(200).optional(),
  repo_path: z.string().min(1),
  default_branch: z.string().optional(),
});

const Start = z.object({
  project_id: z.string().min(1),
  goal: z.string().min(1).max(4000),
  run_swe: z.boolean().optional(),
});

const Discard = z.object({
  session_id: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const action = body?.action as string;

  if (action === "register") {
    const parsed = Register.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload.", issues: parsed.error.issues }, { status: 400 });
    }
    const repoPath = expandHome(parsed.data.repo_path);
    if (!pathUnderApproved(repoPath, approved())) {
      return NextResponse.json(
        { error: "repo_path must be under approved folders (Settings)." },
        { status: 400 }
      );
    }
    if (!fs.existsSync(repoPath)) {
      return NextResponse.json({ error: "Path does not exist." }, { status: 400 });
    }
    const defaultBranch = parsed.data.default_branch || detectDefaultBranch(repoPath);
    const remote = detectRemoteUrl(repoPath);
    const gh = parseGithubRemote(remote);
    const project = createCodingProject({
      name: parsed.data.name || path.basename(repoPath),
      repo_path: repoPath,
      default_branch: defaultBranch,
      remote_url: remote,
      github_owner: gh?.owner ?? null,
      github_repo: gh?.repo ?? null,
    });
    return NextResponse.json({ project });
  }

  if (action === "start") {
    const parsed = Start.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload.", issues: parsed.error.issues }, { status: 400 });
    }
    const { resolvePlacement } = await import("@/lib/fleet/placement-pins");
    const placement = await resolvePlacement();
    const result = createWorktreeSession({
      projectId: parsed.data.project_id,
      goal: parsed.data.goal,
      ownerUserId: user.id,
      computePeerId: placement.compute.kind === "peer" ? placement.compute.peer_node_id : "local",
      workspacePeerId: placement.workspace.kind === "peer" ? placement.workspace.peer_node_id : "local",
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    let graph_id: string | undefined;
    if (parsed.data.run_swe !== false) {
      const loop = await startSweLoop(result.session.id);
      if (loop.ok) graph_id = loop.graph_id;
    }
    return NextResponse.json({ session: result.session, graph_id });
  }

  if (action === "discard") {
    const parsed = Discard.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }
    const result = discardWorktreeSession(parsed.data.session_id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_project") {
    const id = String(body?.project_id || "");
    if (!id || !getCodingProject(id)) {
      return NextResponse.json({ error: "Unknown project." }, { status: 404 });
    }
    const sessions = listCodingSessions(id);
    for (const s of sessions) {
      if (s.status !== "discarded") {
        const d = discardWorktreeSession(s.id);
        if (!d.ok) {
          return NextResponse.json(
            { error: `Cannot delete project: session ${s.id} — ${d.error}` },
            { status: 400 }
          );
        }
      }
    }
    deleteCodingProject(id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
