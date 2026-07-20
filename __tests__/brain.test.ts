import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/lib/db/migrations";

// Back the brain accessor with an in-memory config DB.
let db: Database.Database;
vi.mock("../src/lib/db", () => ({
  getConfigDb: () => db,
}));

import {
  slugifyEntity,
  extractWikiLinks,
  upsertEdge,
  listEdges,
  deleteEdgesFor,
  extractAndUpsertEdges,
} from "../src/lib/db/brain";

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, "config");
});

describe("slugifyEntity", () => {
  it("normalizes names to stable slugs", () => {
    expect(slugifyEntity("Ada Lovelace")).toBe("ada-lovelace");
    expect(slugifyEntity("Acme, Inc.")).toBe("acme-inc");
    expect(slugifyEntity("notes.md")).toBe("notes");
  });
});

describe("extractWikiLinks", () => {
  it("pulls [[links]] and supports [[target|alias]]", () => {
    const md = "Met [[Ada Lovelace]] about [[Project X|the project]]. Also [[Ada Lovelace]] again.";
    expect(extractWikiLinks(md).sort()).toEqual(["Ada Lovelace", "Project X"]);
  });
});

describe("brain_edges migration", () => {
  it("creates the brain_edges table", () => {
    const cols = (db.prepare("PRAGMA table_info(brain_edges)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining(["id", "src_entity", "dst_entity", "edge_type", "source", "weight", "created_at"])
    );
  });
});

describe("upsertEdge", () => {
  it("inserts a typed edge", () => {
    upsertEdge({ src: "Alice", dst: "Acme", type: "works_at", source: "stated" });
    const edges = listEdges("alice");
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ src_entity: "alice", dst_entity: "acme", edge_type: "works_at", source: "stated" });
  });

  it("is idempotent and reinforces weight on repeat", () => {
    upsertEdge({ src: "Alice", dst: "Acme", type: "works_at" });
    upsertEdge({ src: "Alice", dst: "Acme", type: "works_at" });
    const edges = listEdges("alice");
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(2);
  });

  it("upgrades inferred → stated but never downgrades", () => {
    upsertEdge({ src: "Alice", dst: "Acme", type: "works_at", source: "inferred" });
    upsertEdge({ src: "Alice", dst: "Acme", type: "works_at", source: "stated" });
    upsertEdge({ src: "Alice", dst: "Acme", type: "works_at", source: "inferred" });
    expect(listEdges("alice")[0].source).toBe("stated");
  });

  it("ignores self-edges and empty entities", () => {
    upsertEdge({ src: "Alice", dst: "Alice", type: "related_to" });
    upsertEdge({ src: "", dst: "Acme", type: "x" });
    expect(listEdges()).toHaveLength(0);
  });
});

describe("extractAndUpsertEdges", () => {
  it("writes a mentioned_in edge per distinct wikilink", () => {
    const n = extractAndUpsertEdges("meeting-2026", "Discussed [[Ada Lovelace]] and [[Project X]].");
    expect(n).toBe(2);
    const edges = listEdges("meeting-2026");
    expect(edges.map((e) => e.dst_entity).sort()).toEqual(["ada-lovelace", "project-x"]);
    expect(edges.every((e) => e.edge_type === "mentioned_in")).toBe(true);
  });
});

describe("deleteEdgesFor", () => {
  it("removes all edges touching an entity", () => {
    upsertEdge({ src: "Alice", dst: "Acme", type: "works_at" });
    upsertEdge({ src: "Bob", dst: "Alice", type: "knows" });
    expect(deleteEdgesFor("Alice")).toBe(2);
    expect(listEdges()).toHaveLength(0);
  });
});
