import { beforeEach, describe, expect, it, vi } from "vitest";

const { getChannel, telegramSend, sendDigestEmail, sendNotification, logger } = vi.hoisted(() => ({
  getChannel: vi.fn(),
  telegramSend: vi.fn(),
  sendDigestEmail: vi.fn(),
  sendNotification: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../src/lib/logger", () => ({ logger }));
vi.mock("../src/lib/db/channels", () => ({ getChannel }));
vi.mock("../src/lib/channels/telegram", () => ({ telegramSend }));
vi.mock("../src/lib/channels/email-digest", () => ({ sendDigestEmail }));
vi.mock("../src/lib/platform/notify", () => ({ sendNotification }));

import { deliver } from "../src/lib/workflow/deliver";

describe("workflow delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChannel.mockReturnValue({ config: { defaultChatId: "chat-1" } });
    telegramSend.mockResolvedValue(undefined);
    sendDigestEmail.mockResolvedValue(undefined);
    sendNotification.mockResolvedValue(undefined);
  });

  it("records browser delivery locally", async () => {
    await expect(deliver("browser", "Reminder")).resolves.toBeUndefined();
    expect(sendNotification).toHaveBeenCalledWith("LocalMind", "Reminder");
    expect(logger.info).toHaveBeenCalledWith("delivery", {
      channel: "browser",
      message: "Reminder",
    });
  });

  it("sends Telegram delivery to the configured default chat", async () => {
    await deliver("telegram", "Reminder");
    expect(telegramSend).toHaveBeenCalledWith("chat-1", "Reminder");
  });

  it("fails when Telegram has no destination instead of pretending to deliver", async () => {
    getChannel.mockReturnValue({ config: {} });
    await expect(deliver("telegram", "Reminder")).rejects.toThrow(/no default chat/i);
  });

  it("propagates channel errors so schedulers and workflows can retry or fail", async () => {
    sendDigestEmail.mockRejectedValue(new Error("SMTP offline"));
    await expect(deliver("email", "Reminder")).rejects.toThrow("SMTP offline");
    expect(logger.error).toHaveBeenCalled();
  });

  it("rejects enabled-but-unimplemented channels", async () => {
    await expect(deliver("whatsapp", "Reminder")).rejects.toThrow(/not implemented/i);
  });
});
