import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/db", () => {
  const convStore = {
    conversations: [] as any[],
    messages: [] as any[],
  };
  const prep = (sql: string) => ({
    run: (...args: any[]) => {
      if (sql.includes("INSERT INTO conversations")) {
        convStore.conversations.push({
          id: args[0], title: args[1], created_at: args[2], updated_at: args[3],
          starred: 0, deleted_at: null, tags: "[]", profile_id: null, owner_user_id: null,
          sync_id: args[4], origin_node_id: args[5],
        });
        return { changes: 1 };
      }
      if (sql.includes("INSERT OR IGNORE INTO messages") || sql.includes("INSERT INTO messages")) {
        const id = args[0];
        if (convStore.messages.some((m) => m.id === id)) return { changes: 0 };
        convStore.messages.push({
          id, conversation_id: args[1], role: args[2], content: args[3],
          created_at: args[4], token_count: args[5], parent_message_id: args[6],
          attachments: args[7], origin_node_id: args[8], origin_label: args[9],
        });
        return { changes: 1 };
      }
      if (sql.includes("UPDATE conversations SET title")) {
        const c = convStore.conversations.find((x) => x.id === args[2]);
        if (c) { c.title = args[0]; c.updated_at = args[1]; }
        return { changes: 1 };
      }
      if (sql.includes("UPDATE conversations SET updated_at")) {
        const c = convStore.conversations.find((x) => x.id === args[1]);
        if (c) c.updated_at = args[0];
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    get: (...args: any[]) => {
      if (sql.includes("sync_id")) {
        return convStore.conversations.find((c) => c.sync_id === args[0] && !c.deleted_at);
      }
      if (sql.includes("FROM conversations WHERE id")) {
        return convStore.conversations.find((c) => c.id === args[0]);
      }
      return undefined;
    },
    all: (...args: any[]) => {
      if (sql.includes("FROM messages")) {
        return convStore.messages
          .filter((m) => m.conversation_id === args[0])
          .sort((a, b) => a.created_at - b.created_at);
      }
      if (sql.includes("FROM conversations WHERE deleted_at IS NULL AND updated_at")) {
        return convStore.conversations.filter((c) => !c.deleted_at && c.updated_at >= args[0]);
      }
      return [];
    },
  });
  return {
    getConvDb: () => ({
      prepare: (sql: string) => prep(sql),
      transaction: (fn: () => void) => () => fn(),
    }),
    __store: convStore,
  };
});

vi.mock("../src/lib/db/fleet", () => ({
  listPeers: vi.fn(() => []),
  parsePeerPolicy: vi.fn(() => ({ sync_conversations: true, advertise_capabilities: true })),
  getPeer: vi.fn(() => ({
    peer_node_id: "peer-a",
    trusted: 1,
    label: "Lab Box",
    policy_json: JSON.stringify({ sync_conversations: true }),
  })),
}));

vi.mock("../src/lib/fleet/identity", () => ({
  getNodeIdentity: vi.fn(() => ({ node_id: "local-node", pubkey_pem: "", privkey_path: "", created_at: 0 })),
}));

vi.mock("../src/lib/fleet/peer-client", () => ({
  sendToPeer: vi.fn(async () => ({ ok: false, status: 0, reason: "offline" })),
}));

vi.mock("../src/lib/db/queries", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/db/queries")>("../src/lib/db/queries");
  return {
    ...actual,
    // Use real getConversation/getMessages against our mocked db via the module —
    // they call getConvDb which is mocked above. scheduleConversationSync is
    // stubbed by not importing fleet from addMessage in these unit tests —
    // we test applySyncedConversations directly.
  };
});

import { applySyncedConversations, handleConversationSync } from "../src/lib/fleet/conversation-sync";

describe("conversation sync", () => {
  beforeEach(async () => {
    const db = await import("../src/lib/db");
    (db as any).__store.conversations.length = 0;
    (db as any).__store.messages.length = 0;
  });

  it("imports a peer thread preserving origin labels and is idempotent", () => {
    const first = applySyncedConversations(
      [
        {
          sync_id: "thread-1",
          title: "Job search",
          updated_at: 2000,
          origin_node_id: "peer-a",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "Find jobs",
              created_at: 1000,
              token_count: 2,
              parent_message_id: null,
              origin_node_id: "peer-a",
              origin_label: "Lab Box",
            },
            {
              id: "m2",
              role: "assistant",
              content: "Here are three roles…",
              created_at: 2000,
              token_count: 8,
              parent_message_id: null,
              origin_node_id: "peer-a",
              origin_label: "Lab Box",
            },
          ],
        },
      ],
      "Lab Box"
    );
    expect(first.conversations).toBe(1);
    expect(first.messages).toBe(2);

    const second = applySyncedConversations(
      [
        {
          sync_id: "thread-1",
          title: "Job search",
          updated_at: 2000,
          origin_node_id: "peer-a",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "Find jobs",
              created_at: 1000,
              token_count: 2,
              parent_message_id: null,
              origin_node_id: "peer-a",
              origin_label: "Lab Box",
            },
          ],
        },
      ],
      "Lab Box"
    );
    expect(second.conversations).toBe(0);
    expect(second.messages).toBe(0);
  });

  it("refuses sync when peer policy disables it", async () => {
    const { parsePeerPolicy } = await import("../src/lib/db/fleet");
    vi.mocked(parsePeerPolicy).mockReturnValueOnce({
      allow_self_actions: false,
      allowed_tools: [],
      advertise_capabilities: true,
      accept_chat_relay: false,
      chat_relay_rate_per_min: 30,
      sync_conversations: false,
    } as any);

    const res = await handleConversationSync({
      envelope_sender: "peer-a",
      payload: { since_ms: 0 },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/disabled/i);
  });
});
