# LocalMind architecture & surface map

Code graph of how UI, agent loop, tools, and data connect. Keep this in sync
when adding pages, tools, or spawn modes.

## Product surface (navigation)

```mermaid
flowchart LR
  subgraph Rail
    Chat["/"]
    Work["/work"]
    Ops["/ops"]
    Browse["/browse"]
    Knowledge["/knowledge"]
    Fleet["/fleet"]
    Settings["/settings"]
  end

  Work --> Graphs["/graphs"]
  Work --> Orch["/orchestration"]
  Work --> Auto["/automations"]
  Work --> Agents["/agents"]
  Work --> Today["/today"]

  Knowledge --> Memory["/memory → ?tab=memory"]
  Knowledge --> Context["/context → ?tab=context"]
  Knowledge --> Data["/data"]

  Fleet --> MCP["/mcp"]
  Fleet --> Models["/models"]
  Fleet --> Plugins["/plugins"]

  Settings --> Perms["/permissions"]
  Settings --> Access["/access"]
  Settings --> Audit["/audit"]
  Settings --> AgentCfg["/agent/*"]

  Chat --> CmdK["⌘K palette"]
  CmdK --> Work
  CmdK --> Knowledge
  CmdK --> Fleet
  CmdK --> Settings
```

Primary nav is the **rail** (`src/components/rail.tsx`). Long-tail destinations
are reached via **⌘K** (`command-palette.tsx`) and the **settings sidebar**
(`settings-sidebar.tsx`). Legacy `MainNav` / `MobileNav` are unused.

## Agent loop & spawn

```mermaid
flowchart TD
  User[User message] --> Engine[runAgent / engine.ts]
  Engine --> Prompt[assemble-system-prompt]
  Engine --> Provider[Provider chat + tools]
  Provider -->|structured tool_call| Guard[permission-guard]
  Provider -->|text-only JSON narration| Recover[parseTextToolCalls]
  Recover --> Guard
  Guard -->|allow / ask / pin| Tools[Tool registry]

  Tools --> Single[spawn_subagent]
  Tools --> Seq[spawn_subagents_sequential]
  Tools --> Par[spawn_subagents_parallel]
  Tools --> Other[web_research / schedule_task / …]

  Single --> Child[runAgentCollect child conv]
  Seq --> Child
  Par --> Child
  Child --> Audit[agent_processes + audit chain]
  Audit --> OpsUI["/ops Kanban"]
  Audit --> WorkUI["/work timeline"]
```

| Spawn tool | Concurrency | Use when |
|---|---|---|
| `spawn_subagent` | 1 child | B needs A's output (chain) |
| `spawn_subagents_sequential` | 1 at a time over a batch | Independent units; spare RAM (default for multi-unit) |
| `spawn_subagents_parallel` | Governor-capped | Independent units; wall-clock speedup |

`agent_mode` (`auto` default / `plan` / `ask`) overlays the permission guard.
Destructive actions always confirm.

## Data & retrieval

```mermaid
flowchart LR
  ChatTurn --> Broker[context-broker]
  Broker --> KB[(knowledge DB)]
  Broker --> Mem[(memory)]
  Broker --> Brain[(~/.localmind/brain)]
  Broker --> PromptSlice[Cited brief in system prompt]

  GraphAPI["/api/context/graph"] --> ContextUI["Knowledge → About you"]
  Brain --> GraphAPI
  Mem --> GraphAPI
```

## Config schema

Config DB migrations live in `src/lib/db/migrations.ts`. Current notable
versions:

| Ver | Change |
|-----|--------|
| v27 | Sora `enabled_tools` backfill (`schedule_task`, `recall`, browse, …) |
| v28 | Default `agent_mode` → `auto` |
| v29 | Grant `spawn_subagents_sequential` to Sora |

## Fleet mesh (LAN)

Paired devices can share one chat timeline and split compute:

```mermaid
flowchart LR
  Mac[Mac · UI] -->|conversation-sync| Spark[DGX / peer]
  Spark -->|conversation-sync| Mac
  Mac -->|Auto placement| Place{least load?}
  Place -->|local| MacSora[Local Sora]
  Place -->|peer| SparkSora[Peer Sora]
  MacSora --> Msg[(messages + origin_label)]
  SparkSora --> Msg
```

- **Sync** — `sync_conversations` peer policy (default on). Push/pull via fleet envelope `conversation-sync`. Each message keeps `origin_node_id` / `origin_label`.
- **Attribution** — chat UI shows `from …` / `via …` per turn.
- **Compute** — chat **Run on → Auto** uses the same load-based placement as task graphs (freshest peer, lowest `active_processes`, local on ties). Explicit peer or “This machine” still available.
- **Remote drive** — `accept_chat_relay` still required before a peer may execute chat on you.