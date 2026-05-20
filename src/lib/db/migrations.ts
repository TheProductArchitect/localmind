import type Database from "better-sqlite3";

type Migration = { version: number; up: (db: Database.Database) => void };

const configMigrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          assistant_name TEXT NOT NULL DEFAULT 'Assistant',
          personality TEXT NOT NULL DEFAULT 'Friendly',
          theme TEXT NOT NULL DEFAULT 'system',
          locale TEXT NOT NULL DEFAULT 'en-US',
          active_profile_id TEXT NOT NULL DEFAULT 'normal',
          pin_hash TEXT,
          data_dir TEXT,
          provider TEXT NOT NULL DEFAULT 'ollama',
          active_model TEXT,
          lan_enabled INTEGER NOT NULL DEFAULT 0,
          port INTEGER NOT NULL DEFAULT 3000,
          https_enabled INTEGER NOT NULL DEFAULT 0,
          approved_dirs TEXT NOT NULL DEFAULT '[]',
          onboarded INTEGER NOT NULL DEFAULT 0,
          chat_font_size INTEGER NOT NULL DEFAULT 14,
          auto_backup INTEGER NOT NULL DEFAULT 1,
          backup_dir TEXT
        );
        INSERT INTO settings (id) VALUES (1);

        CREATE TABLE permission_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tiers TEXT NOT NULL,
          builtin INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          action_type TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          input TEXT NOT NULL,
          output_summary TEXT,
          status TEXT NOT NULL,
          approved_by TEXT NOT NULL,
          conversation_id TEXT,
          row_hash TEXT NOT NULL
        );
        CREATE INDEX idx_audit_ts ON audit_log(timestamp DESC);
        CREATE INDEX idx_audit_conv ON audit_log(conversation_id);

        CREATE TABLE memory (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL UNIQUE,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          source_conversation_id TEXT
        );

        CREATE TABLE api_keys (
          provider TEXT PRIMARY KEY,
          encrypted_key TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE mcp_servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          description TEXT,
          tier TEXT NOT NULL DEFAULT 'ask',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE permission_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action_type TEXT NOT NULL,
          scope TEXT,
          tier TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);

      const now = Date.now();
      const profiles = [
        {
          id: "locked-down",
          name: "Locked Down",
          tiers: {
            read_files: "pin", write_files: "pin", delete_files: "pin",
            read_calendar: "pin", write_calendar: "pin",
            read_email: "pin", send_email: "pin",
            open_applications: "pin", browser_automation: "pin",
            pull_models: "pin", delete_models: "pin",
            change_settings: "pin", export_data: "pin",
            web_search: "ask", memory_read: "allow", memory_write: "ask",
          },
        },
        {
          id: "normal",
          name: "Normal",
          tiers: {
            read_files: "allow", write_files: "ask", delete_files: "ask",
            read_calendar: "allow", write_calendar: "ask",
            read_email: "ask", send_email: "pin",
            open_applications: "ask", browser_automation: "ask",
            pull_models: "ask", delete_models: "ask",
            change_settings: "ask", export_data: "ask",
            web_search: "allow", memory_read: "allow", memory_write: "allow",
          },
        },
        {
          id: "autonomous",
          name: "Autonomous",
          tiers: {
            read_files: "allow", write_files: "allow", delete_files: "ask",
            read_calendar: "allow", write_calendar: "allow",
            read_email: "allow", send_email: "ask",
            open_applications: "allow", browser_automation: "allow",
            pull_models: "ask", delete_models: "ask",
            change_settings: "ask", export_data: "ask",
            web_search: "allow", memory_read: "allow", memory_write: "allow",
          },
        },
        {
          id: "read-only",
          name: "Read Only",
          tiers: {
            read_files: "allow", write_files: "pin", delete_files: "pin",
            read_calendar: "allow", write_calendar: "pin",
            read_email: "allow", send_email: "pin",
            open_applications: "pin", browser_automation: "pin",
            pull_models: "ask", delete_models: "pin",
            change_settings: "ask", export_data: "ask",
            web_search: "allow", memory_read: "allow", memory_write: "ask",
          },
        },
      ];
      const ins = db.prepare(
        "INSERT INTO permission_profiles (id, name, tiers, builtin, created_at) VALUES (?,?,?,1,?)"
      );
      for (const p of profiles) ins.run(p.id, p.name, JSON.stringify(p.tiers), now);
    },
  },
];

// ---- V2 migration ----
configMigrations.push({
  version: 2,
  up: (db) => {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        auth_method TEXT NOT NULL DEFAULT 'pin',
        pin_hash TEXT,
        permission_profile_id TEXT,
        allowed_channels TEXT NOT NULL DEFAULT '[]',
        avatar TEXT,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device TEXT,
        ip TEXT,
        auth_method TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        refresh_token_hash TEXT
      );

      CREATE TABLE passkey_credentials (
        credential_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );

      CREATE TABLE roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        allowed_tools TEXT NOT NULL DEFAULT '[]',
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE mcp_tools (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        description TEXT,
        parameter_schema TEXT,
        tier TEXT NOT NULL DEFAULT 'ask',
        call_count INTEGER NOT NULL DEFAULT 0,
        last_called_at INTEGER
      );

      CREATE TABLE workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        creator_user_id TEXT,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        trigger_config TEXT NOT NULL DEFAULT '{}',
        steps TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_run_at INTEGER
      );

      CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        triggered_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL,
        step_results TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        creator_user_id TEXT,
        cron TEXT NOT NULL,
        prompt TEXT NOT NULL,
        delivery_channel TEXT NOT NULL DEFAULT 'browser',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_run_at INTEGER,
        last_output TEXT
      );

      CREATE TABLE monitors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        creator_user_id TEXT,
        check_type TEXT NOT NULL,
        check_config TEXT NOT NULL DEFAULT '{}',
        frequency_seconds INTEGER NOT NULL DEFAULT 3600,
        last_checked_at INTEGER,
        last_status TEXT,
        trigger_workflow_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        description TEXT NOT NULL,
        target_date TEXT,
        milestones TEXT NOT NULL DEFAULT '[]',
        progress_notes TEXT NOT NULL DEFAULT '[]',
        progress INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE communication_channels (
        channel_type TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        last_message_at INTEGER
      );

      CREATE TABLE codebases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        last_indexed_at INTEGER,
        file_count INTEGER NOT NULL DEFAULT 0,
        commands TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE codebase_files (
        id TEXT PRIMARY KEY,
        codebase_id TEXT NOT NULL,
        rel_path TEXT NOT NULL,
        language TEXT,
        summary TEXT,
        symbols TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE dev_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'normal',
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      ALTER TABLE mcp_servers ADD COLUMN transport TEXT NOT NULL DEFAULT 'sse';
      ALTER TABLE mcp_servers ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE mcp_servers ADD COLUMN env_encrypted TEXT;
      ALTER TABLE mcp_servers ADD COLUMN command TEXT;
      ALTER TABLE mcp_servers ADD COLUMN last_connected_at INTEGER;
      ALTER TABLE mcp_servers ADD COLUMN allowlist TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE audit_log ADD COLUMN user_id TEXT;
      ALTER TABLE settings ADD COLUMN require_login INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE settings ADD COLUMN guest_mode INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE settings ADD COLUMN devpm_model TEXT;
      ALTER TABLE settings ADD COLUMN tts_voice TEXT;
      ALTER TABLE settings ADD COLUMN auto_capture INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE settings ADD COLUMN api_token_hash TEXT;
    `);

    const now = Date.now();
    const roles = [
      { id: "owner", name: "Owner", tools: "*" },
      { id: "member", name: "Member", tools: "*" },
      { id: "guest", name: "Guest", tools: JSON.stringify(["web_search", "memory"]) },
    ];
    const rIns = db.prepare(
      "INSERT INTO roles (id,name,allowed_tools,builtin,created_at) VALUES (?,?,?,1,?)"
    );
    for (const r of roles) rIns.run(r.id, r.name, r.tools, now);
  },
});

// ---- V3 migration ----
configMigrations.push({
  version: 3,
  up: (db) => {
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        progress INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        error TEXT
      );
      CREATE INDEX idx_jobs_status ON jobs(status, created_at);

      CREATE TABLE security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        kind TEXT NOT NULL,
        detail TEXT,
        user_id TEXT
      );
    `);
  },
});

// ---- V4 migration: per-user isolation columns ----
configMigrations.push({
  version: 4,
  up: (db) => {
    db.exec("ALTER TABLE memory ADD COLUMN user_id TEXT;");
  },
});

const knowledgeMigrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          file_path TEXT,
          file_name TEXT NOT NULL,
          file_type TEXT NOT NULL,
          last_indexed_at INTEGER NOT NULL,
          chunk_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'indexed'
        );

        CREATE TABLE chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          text TEXT NOT NULL,
          embedding BLOB,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_chunks_doc ON chunks(document_id);

        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          linked_note_ids TEXT NOT NULL DEFAULT '[]',
          tags TEXT NOT NULL DEFAULT '[]',
          source_conversation_id TEXT
        );
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec("ALTER TABLE notes ADD COLUMN owner_user_id TEXT;");
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        ALTER TABLE documents ADD COLUMN error TEXT;
        ALTER TABLE documents ADD COLUMN file_hash TEXT;

        CREATE VIRTUAL TABLE notes_fts USING fts5(note_id UNINDEXED, title, content);
        CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(note_id, title, content) VALUES (new.id, new.title, new.content);
        END;
        CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
          UPDATE notes_fts SET title=new.title, content=new.content WHERE note_id=new.id;
        END;
        CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
          DELETE FROM notes_fts WHERE note_id=old.id;
        END;
      `);
    },
  },
];

const convMigrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL DEFAULT 'New conversation',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          starred INTEGER NOT NULL DEFAULT 0,
          deleted_at INTEGER,
          tags TEXT NOT NULL DEFAULT '[]',
          profile_id TEXT
        );
        CREATE INDEX idx_conv_updated ON conversations(updated_at DESC);

        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0,
          parent_message_id TEXT
        );
        CREATE INDEX idx_msg_conv ON messages(conversation_id, created_at);

        CREATE TABLE tool_calls (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          input TEXT NOT NULL,
          output TEXT,
          status TEXT NOT NULL,
          duration_ms INTEGER
        );
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec("ALTER TABLE conversations ADD COLUMN owner_user_id TEXT;");
    },
  },
];

export function runMigrations(db: Database.Database, kind: "config" | "conversations" | "knowledge") {
  db.exec("CREATE TABLE IF NOT EXISTS _schema (version INTEGER PRIMARY KEY)");
  const cur = db.prepare("SELECT MAX(version) AS v FROM _schema").get() as { v: number | null };
  const current = cur.v ?? 0;
  const set =
    kind === "config" ? configMigrations : kind === "knowledge" ? knowledgeMigrations : convMigrations;
  for (const m of set) {
    if (m.version > current) {
      const tx = db.transaction(() => {
        m.up(db);
        db.prepare("INSERT INTO _schema (version) VALUES (?)").run(m.version);
      });
      tx();
    }
  }
}
