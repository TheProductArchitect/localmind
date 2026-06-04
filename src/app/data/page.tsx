"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Badge } from "@/components/ui";
import { Database, FileSpreadsheet, RefreshCw, Download, ExternalLink } from "lucide-react";

type Table = { table_name: string; schema_json: string; row_count: number; updated_at: number };
type Record = { record_id: string; data_json: string; created_at: number };
type SheetFile = { path: string; rows: number; size: number; modified: number };

function basename(p: string): string {
  return p.split("/").pop() || p;
}
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function DataPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [sheets, setSheets] = useState<SheetFile[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [activeRecords, setActiveRecords] = useState<Record[]>([]);
  const [activeSheet, setActiveSheet] = useState<{ path: string; headers: string[]; rows: { [k: string]: string }[] } | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      fetch("/api/data/tables").then((r) => r.json()),
      fetch("/api/data/spreadsheets").then((r) => r.json()),
    ]);
    setTables(t.tables || []);
    setSheets(s.spreadsheets || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openTable(name: string) {
    setActiveTable(name);
    setActiveSheet(null);
    const r = await fetch(`/api/data/tables/${encodeURIComponent(name)}?limit=200`);
    const j = await r.json();
    setActiveRecords(j.records || []);
  }

  async function openSheet(path: string) {
    setActiveSheet(null);
    setActiveTable(null);
    const token = encodeURIComponent(Buffer.from(path, "utf8").toString("base64url"));
    const r = await fetch(`/api/data/spreadsheets/${token}`);
    const j = await r.json();
    if (j.error) return;
    setActiveSheet({ path: j.path, headers: j.headers, rows: j.rows });
  }

  return (
    <div className="mx-auto max-w-5xl px-10 py-14 space-y-6">
      <div className="flex items-end justify-between gap-6 mb-2">
        <div>
          <p className="lm-micro mb-2">Data</p>
          <h1 className="lm-display">Tables &amp; spreadsheets</h1>
        </div>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Structured data the agent has produced via the <code>datastore</code> and <code>spreadsheet</code> tools.
        Records are scoped to your machine. CSV files live in your approved folders and stay there — LocalMind doesn't copy them.
      </p>

      {/* Datastore tables */}
      <section>
        <h2 className="text-sm font-medium mb-2">Datastore tables ({tables.length})</h2>
        {tables.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            No datastore tables yet. Ask the assistant to remember structured data: <em>“Track my weekly expenses in a table called <code>expenses</code> with columns date, category, amount.”</em>
          </Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tables.map((t) => (
              <Card key={t.table_name} className="p-3 cursor-pointer hover:bg-accent/40" onClick={() => openTable(t.table_name)}>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm flex-1">{t.table_name}</p>
                  <Badge variant="outline">{t.row_count} rows</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Updated {new Date(t.updated_at).toLocaleString()}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Active table records */}
      {activeTable && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium flex-1">{activeTable} — last {activeRecords.length} record(s)</p>
            <Button size="sm" variant="ghost" onClick={() => setActiveTable(null)}>Close</Button>
          </div>
          <pre className="text-xs bg-muted/40 rounded p-2 max-h-80 overflow-y-auto">
            {activeRecords.length === 0 ? "(no records)" : activeRecords.map((r) => `[${r.record_id}] ${r.data_json}`).join("\n")}
          </pre>
        </Card>
      )}

      {/* Spreadsheets */}
      <section>
        <h2 className="text-sm font-medium mb-2">CSV files ({sheets.length})</h2>
        {sheets.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            No CSV files in your approved folders. Ask the assistant to create one: <em>“Create a CSV at ~/Documents/expenses.csv with columns date, category, amount.”</em>
          </Card>
        ) : (
          <div className="space-y-1">
            {sheets.map((s) => {
              const token = Buffer.from(s.path, "utf8").toString("base64url");
              return (
                <Card key={s.path} className="p-3 flex items-center gap-3">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{basename(s.path)}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.path}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{s.rows} rows · {bytes(s.size)}</span>
                  <Button size="sm" variant="outline" onClick={() => openSheet(s.path)}>
                    Open
                  </Button>
                  <a href={`/api/data/spreadsheets/${encodeURIComponent(token)}?download=1`}>
                    <Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /></Button>
                  </a>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Active spreadsheet preview */}
      {activeSheet && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-sm font-medium flex-1 truncate">{basename(activeSheet.path)}</p>
            <a
              href={`file://${activeSheet.path}`}
              className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
            >
              Open in default app <ExternalLink className="h-3 w-3" />
            </a>
            <Button size="sm" variant="ghost" onClick={() => setActiveSheet(null)}>Close</Button>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="text-xs">
              <thead className="text-muted-foreground sticky top-0 bg-card">
                <tr>
                  {activeSheet.headers.map((h) => (
                    <th key={h} className="text-left py-1 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeSheet.rows.map((row, i) => (
                  <tr key={i} className="border-t">
                    {activeSheet.headers.map((h) => (
                      <td key={h} className="py-1 pr-3 whitespace-nowrap">{row[h]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
