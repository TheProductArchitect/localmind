import { createConversation } from "../db/queries";
import { runAgentCollect } from "../agent/engine";
import { markChannelMessage, type ChannelType } from "../db/channels";
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
  const convId = conversationFor(channel, externalUserId);
  const prefix = `This message arrived via the ${channel} channel. Sensitive actions cannot be confirmed here — if one is needed, ask the user to use the browser. Keep replies concise for messaging.`;
  return runAgentCollect(convId, text, { systemPrefix: prefix });
}
