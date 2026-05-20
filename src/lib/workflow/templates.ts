// Shipped workflow templates the user can install and customise.
export const WORKFLOW_TEMPLATES = [
  {
    id: "daily-code-review",
    name: "Daily code review",
    trigger_type: "schedule",
    steps: [
      { type: "agent", prompt: "List all GitHub pull requests opened or updated today across my connected repos." },
      { type: "agent", prompt: "For each PR above, summarise the diff and flag any risks: {{last}}" },
      { type: "notify", channel: "telegram", message: "Daily code review:\n{{last}}" },
    ],
  },
  {
    id: "meeting-prep",
    name: "Meeting prep",
    trigger_type: "schedule",
    steps: [
      { type: "agent", prompt: "What are my next calendar events? Pull details." },
      { type: "agent", prompt: "Find related notes in the knowledge base for: {{last}}" },
      { type: "notify", channel: "telegram", message: "Meeting prep brief:\n{{last}}" },
    ],
  },
  {
    id: "new-email-triage",
    name: "New email triage",
    trigger_type: "manual",
    steps: [
      { type: "agent", prompt: "Read my recent inbox messages and summarise each." },
      { type: "condition", contains: "urgent", skipIfFalse: 1 },
      { type: "notify", channel: "telegram", message: "Urgent email:\n{{last}}" },
      { type: "agent", prompt: "Add the non-urgent items to today's digest: {{last}}" },
    ],
  },
  {
    id: "release-notes",
    name: "Release notes",
    trigger_type: "manual",
    steps: [
      { type: "agent", prompt: "Fetch commits since the last release and write human-readable release notes." },
      { type: "notify", channel: "telegram", message: "Release notes ready:\n{{last}}" },
    ],
  },
];
