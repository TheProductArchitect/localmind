// Curated MCP server registry. In production this is fetched from a GitHub-hosted
// JSON file and cached; here it ships as a built-in catalogue usable fully offline.
export type RegistryEntry = {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  tools: string[];
  permissions: string;
  repo: string;
  install: { transport: "stdio"; command: string };
};

export const REGISTRY: RegistryEntry[] = [
  {
    id: "github", name: "GitHub", author: "modelcontextprotocol", version: "1.0.0",
    description: "List repos, read files, manage issues and PRs, check CI status.",
    tools: ["list_repositories", "get_file_contents", "create_issue", "list_issues", "create_pull_request", "get_pr_diff", "check_ci"],
    permissions: "Ask First", repo: "github.com/modelcontextprotocol/servers",
    install: { transport: "stdio", command: "npx -y @modelcontextprotocol/server-github" },
  },
  {
    id: "gitlab", name: "GitLab", author: "modelcontextprotocol", version: "1.0.0",
    description: "List projects, read files, manage issues and merge requests.",
    tools: ["list_projects", "get_file", "create_issue", "create_mr"],
    permissions: "Ask First", repo: "github.com/modelcontextprotocol/servers",
    install: { transport: "stdio", command: "npx -y @modelcontextprotocol/server-gitlab" },
  },
  {
    id: "filesystem", name: "Filesystem (extended)", author: "modelcontextprotocol", version: "1.0.0",
    description: "Extended filesystem access with directory trees and search.",
    tools: ["read_file", "write_file", "list_directory", "search_files"],
    permissions: "Ask First", repo: "github.com/modelcontextprotocol/servers",
    install: { transport: "stdio", command: "npx -y @modelcontextprotocol/server-filesystem" },
  },
  {
    id: "postgres", name: "Postgres", author: "modelcontextprotocol", version: "1.0.0",
    description: "Read-only SQL query execution against a Postgres database.",
    tools: ["query", "list_tables", "describe_table"],
    permissions: "Never Without PIN", repo: "github.com/modelcontextprotocol/servers",
    install: { transport: "stdio", command: "npx -y @modelcontextprotocol/server-postgres" },
  },
  {
    id: "slack", name: "Slack", author: "modelcontextprotocol", version: "1.0.0",
    description: "Read and post Slack messages, list channels, search.",
    tools: ["post_message", "read_messages", "list_channels", "search_messages"],
    permissions: "Ask First", repo: "github.com/modelcontextprotocol/servers",
    install: { transport: "stdio", command: "npx -y @modelcontextprotocol/server-slack" },
  },
  {
    id: "obsidian", name: "Obsidian Vault", author: "community", version: "1.0.0",
    description: "Read, create, search, and link notes in a local Obsidian vault.",
    tools: ["read_note", "create_note", "search_notes", "get_backlinks"],
    permissions: "Ask First", repo: "github.com/community/obsidian-mcp",
    install: { transport: "stdio", command: "npx -y obsidian-mcp" },
  },
  {
    id: "memory", name: "Knowledge Graph Memory", author: "modelcontextprotocol", version: "1.0.0",
    description: "Persistent knowledge graph the assistant can read and write.",
    tools: ["create_entities", "create_relations", "search_nodes", "read_graph"],
    permissions: "Always Allow", repo: "github.com/modelcontextprotocol/servers",
    install: { transport: "stdio", command: "npx -y @modelcontextprotocol/server-memory" },
  },
];
