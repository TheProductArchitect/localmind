import { createConversation } from "../db/queries";
import { runAgentCollect } from "../agent/engine";
import { markChannelMessage, type ChannelType } from "../db/channels";
import { tryChannelConfirmation } from "../agent/confirmations";
import { logger } from "../logger";

// Maps a channel + external user id to a LocalMind conversation.
const channelConversations = new Map<string, string>();

function conversationFor(channel: string, externalId: string): string {
  const key = `${channel}:${externalId}`;
  let id = channelConversations.get(key);
  if (!id) {
    id = createConversation().id;
    channelConversations.set(key, id);
  }
  return id;
}

// Processes an inbound message from any channel and returns the agent's reply text.
export async function handleInbound(
  channel: ChannelType,
  externalUserId: string,
  text: string
): Promise<string> {
  logger.info("channel inbound", { channel, externalUserId });
  markChannelMessage(channel);
  const channelKey = `${channel}:${externalUserId}`;

  const confirmation = tryChannelConfirmation(channelKey, text);
  if (confirmation.handled) {
    return confirmation.decision === "allow"
      ? `Approved: ${confirmation.preview || "action"}. Processing will continue.`
      : `Denied: ${confirmation.preview || "action"}.`;
  }

  const convId = conversationFor(channel, externalUserId);
  const prefix = `This message arrived via the ${channel} channel. For actions that need approval, reply YES to approve or NO to deny when prompted. Keep replies concise for messaging.`;
  return runAgentCollect(convId, text, {
    systemPrefix: prefix,
    processMetadata: { channel_key: channelKey },
  });
}
