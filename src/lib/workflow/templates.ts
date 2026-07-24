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
  {
    id: "url-watch-digest",
    name: "URL watch digest",
    trigger_type: "manual",
    steps: [
      {
        type: "agent",
        prompt:
          "A page-content monitor just fired. Summarise what likely changed on the watched URL (use read_secure_webpage if a URL is in context). Keep it to 5 bullets.",
      },
      { type: "notify", channel: "browser", message: "Page watch digest:\n{{last}}" },
    ],
  },
  {
    id: "daily-scrape-digest",
    name: "Daily scrape digest",
    trigger_type: "schedule",
    steps: [
      {
        type: "agent",
        prompt:
          "Read the URLs the user cares about (from memory or the prompt context) with read_secure_webpage / web_research. Produce a short daily digest of notable changes.",
      },
      { type: "notify", channel: "email", message: "Daily scrape digest:\n{{last}}" },
    ],
  },
  {
    id: "email-reminder",
    name: "Email reminder",
    trigger_type: "schedule",
    steps: [
      {
        type: "agent",
        prompt:
          "Compose a short reminder email to myself based on this workflow's purpose (check calendar/reminders if helpful). Then send it with the email tool to my own address if available, otherwise prepare the body for notify.",
      },
      { type: "notify", channel: "email", message: "Reminder:\n{{last}}" },
    ],
  },
  {
    id: "inbox-triage-digest",
    name: "Inbox triage digest",
    trigger_type: "manual",
    steps: [
      { type: "agent", prompt: "Read my recent inbox and triage into urgent / later / FYI with one-line reasons." },
      { type: "notify", channel: "email", message: "Inbox triage:\n{{last}}" },
    ],
  },
  {
    id: "morning-ops-brief",
    name: "Morning ops brief",
    trigger_type: "schedule",
    steps: [
      {
        type: "agent",
        prompt:
          "Brief me for the morning: today's calendar, open reminders, and any Ops items that need me (approvals / Needs you). Keep it under 12 lines.",
      },
      { type: "notify", channel: "browser", message: "Morning ops brief:\n{{last}}" },
    ],
  },
];
