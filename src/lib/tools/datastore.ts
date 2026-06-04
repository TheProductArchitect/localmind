import type { Tool } from "./types";
import {
  ensureTable,
  putRecord,
  listRecords,
  listTables,
  deleteRecord,
} from "../db/datastore";

/**
 * Agent-facing datastore tool. Lightweight, schemaless JSON records grouped
 * by named tables. Distinct from the memory tool (which stores user-facts
 * intended for the AI to recall in future conversations) — this is for
 * structured data the agent produces: expense rows, research findings,
 * extraction outputs, task ledgers.
 */
export const datastoreTool: Tool = {
  actionType: "memory_write",
  classify: (i) => (i.operation === "get" || i.operation === "list_tables" ? "memory_read" : "memory_write"),
  preview: (i) => {
    if (i.operation === "put") return `Save a record to table "${i.table}"`;
    if (i.operation === "get") return `Read up to ${i.limit ?? 100} records from "${i.table}"`;
    if (i.operation === "list_tables") return "List all datastore tables";
    if (i.operation === "delete") return `Delete record ${i.record_id} from "${i.table}"`;
    return `Datastore: ${i.operation}`;
  },
  version: "1",
  cacheable: (i) => i.operation === "get" || i.operation === "list_tables",
  definition: {
    name: "datastore",
    description:
      "Read and write structured JSON records grouped by named tables. Use for typed data the agent generates (research findings, expenses, tasks, entity lists). For free-form facts about the user, use the memory tool instead.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["put", "get", "list_tables", "delete"] },
        table: { type: "string", description: "Table name (letters, digits, underscore, dash; starts with a letter)." },
        record_id: { type: "string", description: "Record id, required for delete." },
        data: { type: "object", description: "Record body, required for put." },
        filter: { type: "object", description: "Optional top-level key/value filter for get." },
        limit: { type: "number", description: "Max records to return for get (default 100, max 1000)." },
        schema: { type: "object", description: "Optional schema metadata to attach when creating a new table via put." },
      },
      required: ["operation"],
    },
  },
  async execute(input) {
    const op = String(input.operation || "");

    if (op === "list_tables") {
      const tables = listTables();
      if (tables.length === 0) {
        return { ok: true, output: "(no datastore tables yet)", summary: "0 tables" };
      }
      const body = tables
        .map((t) => `- ${t.table_name} (${t.row_count} rows)`)
        .join("\n");
      return { ok: true, output: body, summary: `${tables.length} table(s)` };
    }

    const table = String(input.table || "").trim();
    if (!table) return { ok: false, output: "table is required" };

    if (op === "put") {
      const data = input.data && typeof input.data === "object" ? input.data : null;
      if (!data) return { ok: false, output: "data must be an object" };
      try {
        if (input.schema && typeof input.schema === "object") {
          ensureTable(table, input.schema as Record<string, unknown>);
        }
        const rec = putRecord(table, data as Record<string, unknown>);
        return {
          ok: true,
          output: `Saved record ${rec.record_id} to "${table}".`,
          summary: `+1 record in ${table}`,
        };
      } catch (e) {
        return { ok: false, output: (e as Error).message };
      }
    }

    if (op === "get") {
      const limit = typeof input.limit === "number" ? input.limit : 100;
      const filter = input.filter && typeof input.filter === "object" ? (input.filter as Record<string, unknown>) : undefined;
      const records = listRecords(table, { limit, filter });
      if (records.length === 0) {
        return { ok: true, output: `(no matching records in "${table}")`, summary: "0 records" };
      }
      const body = records
        .map((r) => `- [${r.record_id}] ${r.data_json}`)
        .join("\n");
      return { ok: true, output: body, summary: `${records.length} record(s) from ${table}` };
    }

    if (op === "delete") {
      const id = String(input.record_id || "");
      if (!id) return { ok: false, output: "record_id is required" };
      const ok = deleteRecord(table, id);
      return ok
        ? { ok: true, output: `Deleted ${id} from "${table}".`, summary: `-1 record in ${table}` }
        : { ok: false, output: `Record ${id} not found in "${table}".` };
    }

    return { ok: false, output: `Unknown operation: ${op}` };
  },
};
