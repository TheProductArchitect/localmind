// Per-user data isolation test. Requires the app running at $LOCALMIND_URL
// (default http://localhost:3000) with no users yet (fresh database).
const BASE = process.env.LOCALMIND_URL || "http://localhost:3000";

function tokenFrom(res) {
  const sc = res.headers.get("set-cookie") || "";
  const m = sc.match(/lm_token=([^;]+)/);
  return m ? m[1] : null;
}
async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers["Cookie"] = `lm_token=${token}`;
  return fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
function fail(msg) { console.log("ISOLATION TEST FAILED: " + msg); process.exit(1); }

(async () => {
  // 1. Bootstrap the owner.
  const boot = await (await api("/api/auth/bootstrap", { method: "POST", body: { display_name: "Owner", pin: "111111" } })).json();
  if (!boot.user?.id) fail("owner account not created");
  const ownerToken = tokenFrom(await api("/api/auth/login", { method: "POST", body: { userId: boot.user.id, pin: "111111" } }));
  if (!ownerToken) fail("owner login produced no token");

  // 2. Owner creates a member.
  const made = await (await api("/api/users", { method: "POST", token: ownerToken, body: { display_name: "Member", role: "member", pin: "222222" } })).json();
  if (!made.user?.id) fail("member account not created: " + JSON.stringify(made));
  const memberToken = tokenFrom(await api("/api/auth/login", { method: "POST", body: { userId: made.user.id, pin: "222222" } }));
  if (!memberToken) fail("member login produced no token");

  // 3. Each user creates conversations + memory.
  const ownerConvs = [];
  for (let i = 0; i < 2; i++) {
    ownerConvs.push((await (await api("/api/conversations", { method: "POST", token: ownerToken })).json()).conversation.id);
  }
  await api("/api/memory", { method: "POST", token: ownerToken, body: { key: "owner-fact", value: "owned" } });

  const memberConvs = [];
  for (let i = 0; i < 2; i++) {
    memberConvs.push((await (await api("/api/conversations", { method: "POST", token: memberToken })).json()).conversation.id);
  }
  await api("/api/memory", { method: "POST", token: memberToken, body: { key: "member-fact", value: "members" } });

  // 4. Owner sees only their own conversations + memory.
  const ownerList = (await (await api("/api/conversations", { token: ownerToken })).json()).conversations;
  if (ownerList.length !== 2) fail(`owner sees ${ownerList.length} conversations, expected 2`);
  const ownerMem = (await (await api("/api/memory", { token: ownerToken })).json()).memory;
  if (ownerMem.length !== 1) fail(`owner sees ${ownerMem.length} memory items, expected 1`);

  // 5. Member sees only their own.
  const memberList = (await (await api("/api/conversations", { token: memberToken })).json()).conversations;
  if (memberList.length !== 2) fail(`member sees ${memberList.length} conversations, expected 2`);
  if (memberList.some((c) => ownerConvs.includes(c.id))) fail("member can see owner's conversations");
  const memberMem = (await (await api("/api/memory", { token: memberToken })).json()).memory;
  if (memberMem.length !== 1 || memberMem[0].key !== "member-fact") fail("member sees wrong memory");

  // 6. Member cannot fetch owner's conversation by ID — must be 404.
  const cross = await api(`/api/conversations/${ownerConvs[0]}`, { token: memberToken });
  if (cross.status !== 404) fail(`member fetched owner conversation, got HTTP ${cross.status}, expected 404`);

  // 7. Member cannot reach an owner-only route.
  const ownerOnly = await api("/api/users", { token: memberToken });
  if (ownerOnly.status !== 403) fail(`member reached owner-only route, got HTTP ${ownerOnly.status}, expected 403`);

  console.log("ISOLATION TEST PASSED");
  process.exit(0);
})().catch((e) => fail(e.message));
