import type Database from "better-sqlite3";

type Migration = { version: number; up: (db: Database.Database) => void };

const configMigrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          assistant_name TEXT NOT NULL DEFAULT 'Sora',
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
          chat_font_size INTEGER NOT NULL DEFAULT 17,
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

// ---- V5 migration: configurable context window ----
// 0 means "auto" — fall back to the per-model table in the engine.
configMigrations.push({
  version: 5,
  up: (db) => {
    db.exec("ALTER TABLE settings ADD COLUMN context_window INTEGER NOT NULL DEFAULT 32768;");
  },
});

// ---- V6 migration: V5-spec tables ----
//
// Adds personas, system prompt blocks, context-window settings, model context
// overrides, orchestration processes & routing rules, long-running jobs &
// checkpoints, plugins, and the datastore tables. Seeds two built-in personas
// (General Assistant, DevPM) with their five built-in system prompt blocks.
configMigrations.push({
  version: 6,
  up: (db) => {
    db.exec(`
      CREATE TABLE personas (
        persona_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        model_name TEXT,
        enabled_tools TEXT NOT NULL DEFAULT '[]',
        permission_profile_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE system_prompt_blocks (
        block_id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        block_type TEXT NOT NULL CHECK (block_type IN ('builtin','custom-static','custom-conditional')),
        block_name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        condition_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_blocks_persona ON system_prompt_blocks(persona_id, sort_order);

      CREATE TABLE context_window_settings (
        settings_id TEXT PRIMARY KEY,
        persona_id TEXT,
        compression_threshold_pct INTEGER NOT NULL DEFAULT 80,
        compression_target_pct INTEGER NOT NULL DEFAULT 50,
        compression_strategy TEXT NOT NULL DEFAULT 'summarise'
          CHECK (compression_strategy IN ('summarise','truncate','sliding_window')),
        summarisation_model TEXT,
        tool_result_max_chars INTEGER NOT NULL DEFAULT 4000,
        per_conversation_override_enabled INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE model_context_overrides (
        model_name TEXT PRIMARY KEY,
        context_window_tokens INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'user-override'
          CHECK (source IN ('hardcoded','reported','user-override')),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE agent_processes (
        process_id TEXT PRIMARY KEY,
        process_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        owner_user_id TEXT,
        agent_name TEXT,
        persona_id TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL,
        current_step TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_agent_proc_status ON agent_processes(status, started_at DESC);
      CREATE INDEX idx_agent_proc_owner ON agent_processes(owner_user_id, started_at DESC);

      CREATE TABLE agent_routing_rules (
        rule_id TEXT PRIMARY KEY,
        sort_order INTEGER NOT NULL DEFAULT 0,
        condition_type TEXT NOT NULL,
        condition_value TEXT,
        target_agent_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE long_running_jobs (
        job_id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        goal TEXT NOT NULL,
        owner_user_id TEXT,
        allowed_tools TEXT NOT NULL DEFAULT '[]',
        max_duration_hours INTEGER NOT NULL DEFAULT 2,
        max_iterations INTEGER NOT NULL DEFAULT 50,
        stopping_condition TEXT NOT NULL DEFAULT 'natural',
        notification_channel TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        last_checkpoint_at INTEGER
      );

      CREATE TABLE job_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        conversation_snapshot TEXT NOT NULL,
        status_description TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_checkpoint_job ON job_checkpoints(job_id, iteration DESC);

      CREATE TABLE plugins (
        plugin_id TEXT PRIMARY KEY,
        plugin_type TEXT NOT NULL
          CHECK (plugin_type IN ('mcp-server','workflow-template','system-prompt-template','agent-config','knowledge-dataset')),
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        source_url TEXT,
        installed_at INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE datastore_tables (
        table_name TEXT PRIMARY KEY,
        schema_json TEXT NOT NULL DEFAULT '{}',
        row_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE datastore_records (
        record_id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_datastore_table ON datastore_records(table_name, created_at DESC);
    `);

    // SQLite computes epoch ms at runtime — deterministic from the migration's
    // point of view and resilient against any host clock weirdness at install.
    const NOW = "(CAST(strftime('%s','now') AS INTEGER) * 1000)";

    db.exec(`
      INSERT INTO personas (persona_id, name, description, model_name, enabled_tools, permission_profile_id, created_at, updated_at) VALUES
        ('persona-general', 'General Assistant', 'Friendly, general-purpose assistant.',         NULL, '[]', 'normal', ${NOW}, ${NOW}),
        ('persona-devpm',   'DevPM',             'Engineering project manager with code-aware tooling.', NULL, '[]', 'normal', ${NOW}, ${NOW});
    `);

    // Seed five built-in blocks per persona. Content is left empty — the
    // assembler generates it at runtime from settings/permissions/tools/memory.
    const personas = ["general", "devpm"];
    // v2: only the three blocks that genuinely belong in every turn's prompt
    // ship enabled by default. `memory` and `date_context` still exist as
    // blocks the user can re-enable from the editor, but Sora gets the same
    // information on demand via the `memory` and `time` tools — no need to
    // pay tokens for it on every single turn.
    const builtins = [
      { name: "identity",     enabled: 1 },
      { name: "permissions",  enabled: 1 },
      { name: "tools",        enabled: 1 },
      { name: "memory",       enabled: 0 },
      { name: "date_context", enabled: 0 },
    ];
    const ins = db.prepare(`
      INSERT INTO system_prompt_blocks
        (block_id, persona_id, block_type, block_name, content, enabled, sort_order, condition_json, created_at, updated_at)
      VALUES (?, ?, 'builtin', ?, '', ?, ?, NULL,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000)
    `);
    for (const p of personas) {
      builtins.forEach((b, i) => {
        ins.run(`blk-${p}-${b.name}`, `persona-${p}`, b.name, b.enabled, i);
      });
    }

    db.exec(`
      INSERT INTO context_window_settings
        (settings_id, persona_id, compression_threshold_pct, compression_target_pct, compression_strategy,
         summarisation_model, tool_result_max_chars, per_conversation_override_enabled, updated_at)
      VALUES
        ('ctx-global', NULL, 80, 50, 'summarise', NULL, 4000, 0, ${NOW});
    `);
  },
});

// ---- V7 migration: long-running job injects + conversation pointer ----
//
// `pending_injects` queues user-supplied "Inject instruction" messages that the
// executor consumes between iterations. `conversation_id` lets the executor pin
// the job to a single conversation across resumes.
configMigrations.push({
  version: 7,
  up: (db) => {
    db.exec(`
      ALTER TABLE long_running_jobs ADD COLUMN pending_injects TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE long_running_jobs ADD COLUMN conversation_id TEXT;
      ALTER TABLE long_running_jobs ADD COLUMN current_iteration INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE long_running_jobs ADD COLUMN process_id TEXT;
    `);
  },
});

// ---- V8 migration: V6 federation foundation ----
//
// All schema needed for the federated task-graph runtime ships in one
// migration so partial states cannot exist. Tables introduced here:
//
//   - node_identity         : this machine's Ed25519 identity (single row).
//   - fleet_peers           : paired peer machines + their public keys.
//   - node_clock            : monotonic Lamport counter (single row).
//   - fleet_audit_links     : cross-references between local and peer audit rows.
//   - knowledge_share_policy: per-document share policy (private / fleet-readable / fleet-queryable).
//   - task_graphs           : a goal with cost budget, status, originating node.
//   - task_nodes            : individual steps with contracts, input hash, cache key.
//   - tool_call_cache       : content-addressed cache of tool outputs keyed by (tool_name, tool_version, input_hash).
//
// Existing V5/V6 tables are untouched — V6 task graphs add to the model, they
// do not replace anything yet. The V6.7 migration later compiles chat /
// workflow / long-running-job to graphs without breaking those rows.
configMigrations.push({
  version: 8,
  up: (db) => {
    db.exec(`
      CREATE TABLE node_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        node_id TEXT NOT NULL,
        pubkey_pem TEXT NOT NULL,
        privkey_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE fleet_peers (
        peer_node_id TEXT PRIMARY KEY,
        pubkey_pem TEXT NOT NULL,
        label TEXT,
        primary_addr TEXT,
        paired_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        policy_json TEXT NOT NULL DEFAULT '{}',
        trusted INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE node_clock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        counter INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO node_clock (id, counter) VALUES (1, 0);

      CREATE TABLE fleet_audit_links (
        local_audit_id INTEGER NOT NULL,
        peer_node_id TEXT NOT NULL,
        peer_audit_id INTEGER NOT NULL,
        signature TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
        lamport INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (local_audit_id, peer_node_id, peer_audit_id, direction)
      );
      CREATE INDEX idx_fleet_audit_peer ON fleet_audit_links(peer_node_id, peer_audit_id);

      CREATE TABLE knowledge_share_policy (
        document_id TEXT PRIMARY KEY,
        policy TEXT NOT NULL DEFAULT 'private'
          CHECK (policy IN ('private','fleet-readable','fleet-queryable')),
        granted_peers_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE task_graphs (
        graph_id TEXT PRIMARY KEY,
        owner_user_id TEXT,
        originating_node_id TEXT NOT NULL,
        root_goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','running','completed','failed','cancelled','halted_budget')),
        cost_budget_json TEXT NOT NULL DEFAULT '{}',
        cost_actual_json TEXT NOT NULL DEFAULT '{}',
        parent_audit_id INTEGER,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE INDEX idx_graphs_status ON task_graphs(status, created_at DESC);
      CREATE INDEX idx_graphs_owner ON task_graphs(owner_user_id, created_at DESC);

      CREATE TABLE task_nodes (
        node_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        parent_ids TEXT NOT NULL DEFAULT '[]',
        depends_on TEXT NOT NULL DEFAULT '[]',
        agent_spec_json TEXT NOT NULL,
        input_json TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        contract_json TEXT NOT NULL,
        placement_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','scheduled','running','done','cached','failed','cancelled','refuted','peer_lost')),
        output_json TEXT,
        output_hash TEXT,
        cache_hit_of_node_id TEXT,
        executing_node_id TEXT,
        cost_actual_json TEXT NOT NULL DEFAULT '{}',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        verification_node_id TEXT,
        process_id TEXT,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX idx_nodes_graph_status ON task_nodes(graph_id, status);
      CREATE INDEX idx_nodes_input_hash ON task_nodes(input_hash, status);
      CREATE INDEX idx_nodes_executing ON task_nodes(executing_node_id, status);

      -- Content-addressed cache of tool outputs. Invalidates when the tool's
      -- declared version changes (decision: tool version field busts cache).
      CREATE TABLE tool_call_cache (
        cache_key TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        tool_version TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        output_json TEXT NOT NULL,
        status TEXT NOT NULL,
        cost_actual_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        last_hit_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_cache_tool ON tool_call_cache(tool_name, tool_version);
      CREATE INDEX idx_cache_recent ON tool_call_cache(last_hit_at DESC);
    `);
  },
});

// v2: agent_mode — a global overlay that shapes how Sora interprets every
// permission tier. "auto" trusts the agent fully; "plan" forbids mutations
// until the user steps out of plan mode; "ask" is the default — Sora may
// read freely but confirms every mutation. Memory reads are always allowed
// regardless of mode (the LLM "owns" its memory).
configMigrations.push({
  version: 9,
  up: (db) => {
    db.exec("ALTER TABLE settings ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'ask';");
  },
});

// v10: disable the `memory` and `date_context` builtin blocks on every
// existing persona. They're now served on-demand via the `memory` and
// `time` tools — keeping them in the prompt was paying tokens for stale
// data on every single turn.
configMigrations.push({
  version: 10,
  up: (db) => {
    db.exec(`
      UPDATE system_prompt_blocks
      SET enabled = 0
      WHERE block_type = 'builtin'
        AND block_name IN ('memory', 'date_context');
    `);
  },
});

// v12: per-agent memory. Each persona gets its own scoped lessons store.
// Writers are restricted to user / sora / system (the critic). The agent
// itself reads its memory at spawn time and cannot write — that's the whole
// safety property: the agent's behavior is shaped by observers, not by
// itself. `status` is 'committed' (active, injected into the agent's
// system prompt) or 'proposed' (queued for sora/user review, NOT yet
// injected). The critic writes proposed by default.
configMigrations.push({
  version: 12,
  up: (db) => {
    db.exec(`
      CREATE TABLE agent_memory (
        memory_id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('lesson','warning','preference','fact')),
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'committed'
          CHECK (status IN ('committed','proposed','retired')),
        created_by TEXT NOT NULL CHECK (created_by IN ('user','sora','system')),
        confidence REAL NOT NULL DEFAULT 1.0,
        source_subagent_process_id TEXT,
        created_at INTEGER NOT NULL,
        retired_at INTEGER
      );
      CREATE INDEX idx_agent_memory_persona_status
        ON agent_memory(persona_id, status, created_at DESC);

      CREATE TABLE agent_critic_queue (
        process_id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        enqueued_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','reviewing','done','failed','skipped')),
        completed_at INTEGER,
        rating INTEGER,
        critic_output TEXT
      );
      CREATE INDEX idx_critic_queue_status ON agent_critic_queue(status, enqueued_at);
    `);
  },
});

// Backfill-only stub above; the real schema setup is happy on a fresh DB.
// (This sentinel comment keeps version 11 below visually adjacent to v12.)
// v11: seed Sora's default agent roster. Sora herself is the single persona
// the user talks to; these are the specialised SUB-agents she can summon via
// spawn_subagent. Each carries a narrow tool surface so the orchestrator's
// "narrow tool surface = focused subagent" rule is enforced by default.
configMigrations.push({
  version: 11,
  up: (db) => {
    const NOW = Date.now();
    const upsert = db.prepare(`
      INSERT INTO personas (persona_id, name, description, model_name, enabled_tools, permission_profile_id, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 'normal', ?, ?)
      ON CONFLICT(persona_id) DO UPDATE SET
        description = excluded.description,
        enabled_tools = excluded.enabled_tools,
        updated_at = excluded.updated_at
    `);

    type Seed = { id: string; name: string; description: string; tools: string[] };
    const SEEDS: Seed[] = [
      {
        id: "persona-sora",
        name: "Sora",
        description: "The lead assistant you talk to. Orchestrates work, decides when to handle a task directly and when to summon a specialised agent. Always confirms destructive actions, never deletes without permission.",
        tools: [
          "memory", "knowledge_base", "web_search", "time", "filesystem",
          "calendar", "email", "browser", "peer_knowledge", "datastore",
          "spreadsheet", "check_resources", "spawn_subagent", "spawn_subagents_parallel",
        ],
      },
      {
        id: "agent-writer",
        name: "Writer",
        description: "Drafts, edits, and rewrites prose, emails, docs, posts. Optimised for tone, clarity, structure. Has no shell or file-write access — returns text for Sora to land.",
        tools: ["memory", "knowledge_base", "web_search", "time"],
      },
      {
        id: "agent-coder",
        name: "Coder",
        description: "Implements code changes across multiple files. Delegates large refactors to the pi.dev coding agent; for small edits uses filesystem directly. Cannot delete files (Sora signs off).",
        tools: ["filesystem", "devpm_codebase", "pi_code", "memory", "web_search"],
      },
      {
        id: "agent-researcher",
        name: "Researcher",
        description: "Searches the web, reads documents, queries paired peers, and returns a synthesised brief with sources. Read-only; never writes or sends.",
        tools: ["web_research", "read_secure_webpage", "web_search", "browser", "knowledge_base", "peer_knowledge", "memory", "time"],
      },
      {
        id: "agent-scheduler",
        name: "Scheduler",
        description: "Owns calendar + cron + automation creation. Knows about timezones, can read existing schedules and propose new ones for Sora to confirm before they're created.",
        tools: ["calendar", "time", "memory", "datastore"],
      },
      {
        id: "agent-summarizer",
        name: "Summarizer",
        description: "Distills long content — meeting transcripts, document stacks, conversation threads — into structured summaries with action items.",
        tools: ["memory", "knowledge_base", "time"],
      },
      {
        id: "agent-reviewer",
        name: "Reviewer",
        description: "Reads diffs and proposals, surfaces correctness issues, security smells, and unclear edge cases. Does not write code — only feedback.",
        tools: ["filesystem", "devpm_codebase", "memory", "web_search"],
      },
      {
        id: "agent-librarian",
        name: "Librarian",
        description: "Manages the knowledge base — ingests new notes, organises tags, finds duplicates, links related items. Never deletes; surfaces candidates for Sora to confirm.",
        tools: ["knowledge_base", "memory", "datastore", "time"],
      },
      {
        id: "agent-analyst",
        name: "Analyst",
        description: "Works with structured data — spreadsheets, datastore tables, CSVs. Computes aggregates, finds outliers, produces small reports.",
        tools: ["datastore", "spreadsheet", "knowledge_base", "memory", "time"],
      },
      {
        id: "agent-comms",
        name: "Comms",
        description: "Drafts outbound messages (email, SMS, WhatsApp). Always returns drafts for Sora to confirm before send — never sends directly.",
        tools: ["email", "memory", "knowledge_base", "time"],
      },
    ];

    for (const s of SEEDS) {
      upsert.run(s.id, s.name, s.description, JSON.stringify(s.tools), NOW, NOW);
    }

    // Make sure the new Sora persona has the standard built-in prompt blocks.
    const builtins = [
      { name: "identity",     enabled: 1 },
      { name: "permissions",  enabled: 1 },
      { name: "tools",        enabled: 1 },
      { name: "memory",       enabled: 0 },
      { name: "date_context", enabled: 0 },
    ];
    const insBlock = db.prepare(`
      INSERT OR IGNORE INTO system_prompt_blocks
        (block_id, persona_id, block_type, block_name, content, enabled, sort_order, condition_json, created_at, updated_at)
      VALUES (?, ?, 'builtin', ?, '', ?, ?, NULL, ?, ?)
    `);
    builtins.forEach((b, i) => {
      insBlock.run(`blk-sora-${b.name}`, "persona-sora", b.name, b.enabled, i, NOW, NOW);
    });
  },
});

// v13: sharpen the General persona's display description.
// The original seed read "Friendly, general-purpose assistant." — accurate but
// underspecified. The persona is the one the user actually talks to (Sora);
// her job is BOTH to do small tasks directly AND to split larger ones into
// units she delegates to the specialist sub-personas. Naming that explicitly
// here means the UI (persona picker, agent roster, system-prompt page) all
// surface the dual identity, not just the prompt assembler.
configMigrations.push({
  version: 13,
  up: (db) => {
    db.prepare("UPDATE personas SET description=?, updated_at=? WHERE persona_id=?").run(
      "Sora — general assistant and orchestrator. Handles small tasks directly; for anything that decomposes into specialised work, splits it up and delegates to the right sub-persona (Writer, Coder, Researcher, Scheduler, Summarizer, Reviewer, Librarian, Analyst, Comms).",
      Date.now(),
      "persona-general"
    );
  },
});

// v14: mark MCP servers shipped with LocalMind as `builtin=1`. Used to:
//   - prevent destructive UI/API ops (delete) on bundled servers
//   - signal in the UI that the entry is a native offering rather than a
//     user-installed one
// The seed itself (the secure-browser row) is inserted at startup by
// `ensureBuiltinMcpServers()` so the launcher path can be resolved relative
// to the running install rather than baked into the migration.
configMigrations.push({
  version: 14,
  up: (db) => {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0;");
  },
});

// Workflow pause state for human_approval steps.
configMigrations.push({
  version: 15,
  up: (db) => {
    db.exec(`
      ALTER TABLE workflow_runs ADD COLUMN paused_step_index INTEGER;
      ALTER TABLE workflow_runs ADD COLUMN paused_vars TEXT;
      ALTER TABLE workflow_runs ADD COLUMN paused_conv_id TEXT;
      ALTER TABLE workflow_runs ADD COLUMN approval_message TEXT;

      CREATE TABLE IF NOT EXISTS workflow_approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        responded_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_approvals_run ON workflow_approvals(run_id);
    `);
  },
});

// v16: web-access controls, ported from Nova's browser design (three-layer
// DOM-access model, adapted to LocalMind's tool architecture):
//   - settings.web_access_killed — the kill switch. When 1, EVERY tool that
//     touches the web (web_search, raw browser, Secure Browser MCP) refuses
//     before any network I/O. Layer 3 in Nova terms: blunt, absolute.
//   - site_grants — per-domain standing grants (Layer 2). policy='allow'
//     lets agents read the domain even when it's sensitive-classed;
//     policy='never' blinds agents to it entirely. Domains not listed fall
//     through to the sensitive-context heuristics (Layer 1) in web-guard.ts.
// NOTE: this was originally drafted as a second v15 migration and never ran
// on DBs that already applied the workflow-pause v15. Kept at v16 so those
// installs actually get the columns/tables.
configMigrations.push({
  version: 16,
  up: (db) => {
    db.exec(`
      ALTER TABLE settings ADD COLUMN web_access_killed INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS site_grants (
        domain TEXT PRIMARY KEY,
        policy TEXT NOT NULL CHECK (policy IN ('allow','never')),
        note TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  },
});

// v17: give Researcher the page-reading tools the orchestrator expects
// (web_research + read_secure_webpage). Prior seed only listed web_search /
// browser, which pushed agents toward search-snippet workarounds.
configMigrations.push({
  version: 17,
  up: (db) => {
    const tools = JSON.stringify([
      "web_research",
      "read_secure_webpage",
      "web_search",
      "browser",
      "knowledge_base",
      "peer_knowledge",
      "memory",
      "time",
    ]);
    db.prepare(
      "UPDATE personas SET enabled_tools=?, updated_at=? WHERE persona_id IN ('agent-researcher','persona-researcher')"
    ).run(tools, Date.now());
  },
});

// v18: re-enable date_context. Serving clock only via the `time` tool made
// small models burn a tool call on every "hello". A one-line clock in the
// prompt is cheaper; `time` remains for explicit clock/scheduling asks.
configMigrations.push({
  version: 18,
  up: (db) => {
    db.exec(`
      UPDATE system_prompt_blocks
      SET enabled = 1, updated_at = ${Date.now()}
      WHERE block_type = 'builtin' AND block_name = 'date_context';
    `);
  },
});

// v19: bump default UI font size. Only touches installs still on a prior
// baked default (14 or 16) so deliberate larger preferences are preserved.
configMigrations.push({
  version: 19,
  up: (db) => {
    db.prepare(
      "UPDATE settings SET chat_font_size = 17 WHERE chat_font_size IN (14, 16)"
    ).run();
  },
});

// v20: app-wide font scale default settled at 17. Re-bump any leftover 14/16
// from installs that already applied v19 when it only targeted 14→16.
configMigrations.push({
  version: 20,
  up: (db) => {
    db.prepare(
      "UPDATE settings SET chat_font_size = 17 WHERE chat_font_size IN (14, 16)"
    ).run();
  },
});

// v21: Ops board (Feature A) + Pillars (Feature F). Tag each process with the
// pillar it advances, link subagents to their spawner so the board can nest
// them, and track an optional 0..1 progress value for a progress bar.
// All nullable / back-filled null so existing rows are untouched.
configMigrations.push({
  version: 21,
  up: (db) => {
    db.exec(`
      ALTER TABLE agent_processes ADD COLUMN pillar TEXT;
      ALTER TABLE agent_processes ADD COLUMN parent_process_id TEXT;
      ALTER TABLE agent_processes ADD COLUMN progress REAL;
      CREATE INDEX IF NOT EXISTS idx_agent_processes_parent ON agent_processes(parent_process_id);
    `);
  },
});

// v22: selectable web-search backend (Feature C1). "auto" preserves today's
// behavior (Brave if BRAVE_API_KEY set, else DuckDuckGo). "you" uses the
// you.com search API with a key stored in api_keys.
configMigrations.push({
  version: 22,
  up: (db) => {
    db.exec("ALTER TABLE settings ADD COLUMN web_search_provider TEXT NOT NULL DEFAULT 'auto';");
  },
});

// v23: the Brain's entity graph (§4.0/§4.3.1). Typed relationships between
// brain entities (and the User Context Graph in §12), populated by a zero-LLM
// extraction pass over [[wikilinks]] on note write. Additive — the existing
// memory/notes/knowledge stores are untouched.
configMigrations.push({
  version: 23,
  up: (db) => {
    db.exec(`
      CREATE TABLE brain_edges (
        id TEXT PRIMARY KEY,
        src_entity TEXT NOT NULL,
        dst_entity TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'inferred',
        weight REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        UNIQUE(src_entity, dst_entity, edge_type)
      );
      CREATE INDEX idx_brain_edges_src ON brain_edges(src_entity);
      CREATE INDEX idx_brain_edges_dst ON brain_edges(dst_entity);
    `);
  },
});

// v24: the Ideate pillar's surface (§6.2) — a "Strategist" persona that runs
// divergent→convergent brainstorming and writes the chosen plan to the Brain.
// Implemented purely as a persona + a custom system-prompt block; no engine
// changes. Reachable from the persona selector and ⌘K.
configMigrations.push({
  version: 24,
  up: (db) => {
    const NOW = Date.now();
    db.prepare(`
      INSERT INTO personas (persona_id, name, description, model_name, enabled_tools, permission_profile_id, created_at, updated_at)
      VALUES ('persona-strategist', 'Strategist',
        'Ideation mode — generates options, pressure-tests them, and converges to a plan, then saves the chosen plan to the Brain and can hand off to execute/coordinate.',
        NULL, ?, 'normal', ?, ?)
      ON CONFLICT(persona_id) DO UPDATE SET
        description = excluded.description,
        enabled_tools = excluded.enabled_tools,
        updated_at = excluded.updated_at
    `).run(
      JSON.stringify(["memory", "knowledge_base", "web_search", "time", "spawn_subagents_parallel", "schedule_task"]),
      NOW,
      NOW
    );

    const insBlock = db.prepare(`
      INSERT OR IGNORE INTO system_prompt_blocks
        (block_id, persona_id, block_type, block_name, content, enabled, sort_order, condition_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);
    // Standard builtins so the persona has identity/permissions/tools context.
    const builtins = [
      { name: "identity", enabled: 1 },
      { name: "permissions", enabled: 1 },
      { name: "tools", enabled: 1 },
    ];
    builtins.forEach((b, i) => {
      insBlock.run(`blk-strategist-${b.name}`, "persona-strategist", "builtin", b.name, "", b.enabled, i, NOW, NOW);
    });
    // The ideation method itself, as a custom-static block.
    const ideate = `## Ideation method
You are in Strategist mode. Work in two phases:
1. DIVERGE — generate a wide set of distinct options. Do not filter yet. Aim for genuinely different approaches, not variations of one.
2. CONVERGE — pressure-test the options (risks, cost, effort, reversibility). Optionally spawn a parallel "red team" via spawn_subagents_parallel to attack the leading ideas. Then converge to a single recommended plan.

Output a structured plan: goal, the options you considered, the chosen approach and why, and concrete next actions. Save the chosen plan as an \`idea\` note in the Brain (knowledge_base) so it persists and can be linked to follow-on execute/coordinate work. Offer to schedule or spin up the execution steps, but do not start execution without the user's go-ahead.`;
    insBlock.run("blk-strategist-ideate", "persona-strategist", "custom-static", "ideate", ideate, 1, 3, NOW, NOW);
  },
});

// v25: idle self-improvement (Feature G.1/G.2). The two-gate flow: idle Sora
// writes proposal *cards* only (Gate 1); a human approval enqueues a build that
// produces a branch/PR (Gate 2); final merge stays human. `self_checks` records
// idle test runs (read-only w.r.t. the app). Idle work is opt-in and windowed.
configMigrations.push({
  version: 25,
  up: (db) => {
    db.exec(`
      CREATE TABLE improvement_proposals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        target_paths TEXT NOT NULL DEFAULT '[]',
        benefit TEXT,
        risk TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        created_at INTEGER NOT NULL,
        approved_at INTEGER,
        branch TEXT,
        pr_url TEXT,
        audit_ref TEXT
      );
      CREATE INDEX idx_improvement_proposals_status ON improvement_proposals(status);

      CREATE TABLE self_checks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_self_checks_created ON self_checks(created_at DESC);
    `);
    // Idle work is off by default. Window defaults to 01:00–06:00 local.
    db.exec("ALTER TABLE settings ADD COLUMN idle_work_enabled INTEGER NOT NULL DEFAULT 0;");
    db.exec("ALTER TABLE settings ADD COLUMN idle_start_hour INTEGER NOT NULL DEFAULT 1;");
    db.exec("ALTER TABLE settings ADD COLUMN idle_end_hour INTEGER NOT NULL DEFAULT 6;");
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
