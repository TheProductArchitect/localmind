import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installBrowserShims, mockFetch } from "../helpers/ui";
import { ToolCallCard, type ToolCallState } from "@/components/chat/tool-call-card";
import { ConfirmationCard, type ConfirmationState } from "@/components/chat/confirmation-card";
import { MicButton, ConversationButton } from "@/components/chat/voice";

vi.mock("@/lib/client/voice-ready", () => ({
  fetchVoiceReady: vi.fn(async () => ({ ready: true })),
}));

vi.mock("@/components/chat/tts", () => ({
  speak: vi.fn(() => ({ done: Promise.resolve(), cancel: vi.fn() })),
  SpeakerButton: ({ text }: { text: string }) => (
    <button type="button" aria-label="Read aloud">{text.slice(0, 12)}</button>
  ),
}));

type RecHandlers = {
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  state: string;
  mimeType: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

function installMediaMocks() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });

  const recorders: RecHandlers[] = [];
  class FakeMediaRecorder {
    ondataavailable: RecHandlers["ondataavailable"] = null;
    onstop: RecHandlers["onstop"] = null;
    state = "inactive";
    mimeType = "audio/webm";
    start = vi.fn(() => {
      this.state = "recording";
    });
    stop = vi.fn(() => {
      this.state = "inactive";
      this.onstop?.();
    });
    constructor() {
      recorders.push(this as unknown as RecHandlers);
    }
    static isTypeSupported = () => true;
  }
  (globalThis as unknown as { MediaRecorder: typeof FakeMediaRecorder }).MediaRecorder =
    FakeMediaRecorder;
  return { recorders, stream, track };
}

/** Tool cards, confirmation gates, and mic chrome used inside the chat thread. */
describe("tool-call-card", () => {
  beforeEach(() => installBrowserShims());

  it("shows running status and expands to reveal input", async () => {
    const user = userEvent.setup();
    const tc: ToolCallState = {
      id: "tc1",
      toolName: "read_file",
      status: "running",
      input: { path: "/tmp/a.txt" },
    };
    render(<ToolCallCard tc={tc} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByText("Input")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /read_file/ }));
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText(/\/tmp\/a\.txt/)).toBeInTheDocument();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallCard
        tc={{
          id: "tc1",
          toolName: "shell",
          status: "allowed",
          input: { cmd: "ls" },
          result: { status: "ok", output: "a.txt" },
        }}
      />
    );
    const toggle = screen.getByRole("button", { name: /shell/ });
    await user.click(toggle);
    expect(screen.getByText("Output")).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("renders done output when the tool finished", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallCard
        tc={{
          id: "tc2",
          toolName: "search",
          status: "allowed",
          input: { q: "x" },
          result: { status: "ok", output: "found 3 matches" },
        }}
      />
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /search/ }));
    expect(screen.getByText("found 3 matches")).toBeInTheDocument();
  });

  it("marks failed results with destructive styling and status", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolCallCard
        tc={{
          id: "tc3",
          toolName: "write_file",
          status: "denied",
          input: {},
          result: { status: "failed", output: "permission denied" },
        }}
      />
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("border-destructive");
    await user.click(screen.getByRole("button", { name: /write_file/ }));
    expect(screen.getByText("permission denied")).toBeInTheDocument();
  });

  it("shows a high-level spawn label and nested agent details", async () => {
    const user = userEvent.setup();
    mockFetch([
      {
        match: "/api/conversations/child-1",
        body: {
          messages: [
            {
              id: "m1",
              role: "tool",
              content: JSON.stringify({
                name: "read_file",
                status: "ok",
                input: { path: "a.ts" },
                output: "export {}",
              }),
            },
          ],
        },
      },
    ]);
    render(
      <ToolCallCard
        tc={{
          id: "tc4",
          toolName: "spawn_subagent",
          status: "allowed",
          input: { persona_id: "coder", goal: "Fix the tests" },
          result: {
            status: "ok",
            output: "done",
            summary: JSON.stringify({
              kind: "subagent",
              conversation_id: "child-1",
              persona: "coder",
              depth: 1,
              goal: "Fix the tests",
              allowed_tools: ["read_file"],
            }),
          },
        }}
      />
    );
    expect(screen.getByText(/coder — Fix the tests/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /coder — Fix the tests/ }));
    expect(screen.getByText(/depth 1/)).toBeInTheDocument();
    expect(screen.getByText(/Goal: Fix the tests/)).toBeInTheDocument();
    expect(screen.getByText(/Tools: read_file/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show what this agent did/ }));
    await waitFor(() => expect(screen.getByText("read_file")).toBeInTheDocument());
    expect(screen.getByText("export {}")).toBeInTheDocument();
  });
});

describe("confirmation-card", () => {
  beforeEach(() => installBrowserShims());

  const base: ConfirmationState = {
    toolCallId: "call-1",
    actionType: "shell.exec",
    preview: "rm -rf /tmp/x",
    timeoutSeconds: 30,
  };

  it("renders action type, preview, and countdown timer", () => {
    render(<ConfirmationCard c={base} onDecide={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName(/Needs you · shell\.exec/);
    expect(screen.getByText("rm -rf /tmp/x")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("30s");
  });

  it("ticks the countdown and marks urgency under 10s", async () => {
    vi.useFakeTimers();
    try {
      render(<ConfirmationCard c={{ ...base, timeoutSeconds: 11 }} onDecide={vi.fn()} />);
      const timer = screen.getByRole("timer");
      expect(timer).not.toHaveAttribute("data-urgent");
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(timer).toHaveTextContent("10s");
      expect(timer).toHaveAttribute("data-urgent", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Allow once and Deny call onDecide with the right args", async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<ConfirmationCard c={base} onDecide={onDecide} />);
    await user.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onDecide).toHaveBeenCalledWith("allow", undefined);
    onDecide.mockClear();
    await user.click(screen.getByRole("button", { name: "Deny" }));
    expect(onDecide).toHaveBeenCalledWith("deny");
  });

  it("disables Allow until PIN has at least 4 chars when required", async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<ConfirmationCard c={{ ...base, requiresPin: true }} onDecide={onDecide} />);
    const allow = screen.getByRole("button", { name: "Allow once" });
    expect(allow).toBeDisabled();
    await user.type(screen.getByLabelText("Confirmation PIN"), "123");
    expect(allow).toBeDisabled();
    await user.type(screen.getByLabelText("Confirmation PIN"), "4");
    expect(allow).toBeEnabled();
    await user.click(allow);
    expect(onDecide).toHaveBeenCalledWith("allow", "1234");
  });

  it("passes an optional PIN through when provided", async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<ConfirmationCard c={base} onDecide={onDecide} />);
    await user.type(screen.getByLabelText("Confirmation PIN"), "9999");
    await user.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onDecide).toHaveBeenCalledWith("allow", "9999");
  });

  it("shows peerLabel copy for fleet-raised gates", () => {
    render(
      <ConfirmationCard
        c={{ ...base, peerLabel: "dgx-1", requiresPin: true }}
        onDecide={vi.fn()}
      />
    );
    expect(screen.getByText(/Needs you · via dgx-1 · shell\.exec/)).toBeInTheDocument();
    expect(
      screen.getByText(/This action is running on dgx-1\. Your decision is sent back over the fleet\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/PIN on dgx-1/)).toBeInTheDocument();
  });
});

describe("voice MicButton", () => {
  beforeEach(() => {
    installBrowserShims();
    installMediaMocks();
  });

  it("renders idle mic with the start-recording label", async () => {
    render(<MicButton onText={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start recording (shift-click for continuous)" })
      ).toBeInTheDocument()
    );
  });

  it("toggles to Stop recording while press-to-talk is active", async () => {
    const user = userEvent.setup();
    render(<MicButton onText={vi.fn()} />);
    const btn = await screen.findByRole("button", {
      name: "Start recording (shift-click for continuous)",
    });
    await user.click(btn);
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop recording" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start recording (shift-click for continuous)" })
      ).toBeInTheDocument()
    );
  });

  it("enters continuous mode on shift-click", async () => {
    const user = userEvent.setup();
    render(<MicButton onText={vi.fn()} />);
    const btn = await screen.findByRole("button", {
      name: "Start recording (shift-click for continuous)",
    });
    await user.keyboard("{Shift>}");
    await user.click(btn);
    await user.keyboard("{/Shift}");
    expect(screen.getByRole("button", { name: "Stop continuous dictation" })).toBeInTheDocument();
  });

  it("hides when STT is unavailable", async () => {
    const { fetchVoiceReady } = await import("@/lib/client/voice-ready");
    vi.mocked(fetchVoiceReady).mockResolvedValueOnce({ ready: false, hint: "install whisper" });
    const { container } = render(<MicButton onText={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("voice ConversationButton", () => {
  beforeEach(() => {
    installBrowserShims();
    installMediaMocks();
  });

  it("starts and stops conversation mode from the Talk control", async () => {
    const user = userEvent.setup();
    render(
      <ConversationButton
        isAssistantBusy={false}
        assistantSay={null}
        onUtterance={vi.fn()}
        onAssistantSpoken={vi.fn()}
      />
    );
    const start = await screen.findByRole("button", { name: "Start conversation" });
    await user.click(start);
    expect(await screen.findByRole("button", { name: "Listening…" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Listening…" }));
    expect(await screen.findByRole("button", { name: "Start conversation" })).toBeInTheDocument();
  });

  it("reports active changes to the parent", async () => {
    const user = userEvent.setup();
    const onActiveChange = vi.fn();
    render(
      <ConversationButton
        isAssistantBusy={false}
        assistantSay={null}
        onUtterance={vi.fn()}
        onAssistantSpoken={vi.fn()}
        onActiveChange={onActiveChange}
      />
    );
    await user.click(await screen.findByRole("button", { name: "Start conversation" }));
    await waitFor(() => expect(onActiveChange).toHaveBeenCalledWith(true));
    await user.click(screen.getByRole("button", { name: "Listening…" }));
    await waitFor(() => expect(onActiveChange).toHaveBeenCalledWith(false));
  });
});
