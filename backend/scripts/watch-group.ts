// Terminal client for manually testing real-time sync (D18): logs in, joins a
// group's room and prints every update. Run one per terminal, as different users.
//
//   npm run watch -- <email> <password> <groupId> [apiUrl]
import { io } from "socket.io-client";

const [email, password, groupId, apiUrl = "http://localhost:3000"] = process.argv.slice(2);
if (!email || !password || !groupId) {
  console.error("Usage: npm run watch -- <email> <password> <groupId> [apiUrl]");
  process.exit(1);
}

interface Update {
  change: { type: string; id?: string; actorId: string } | null;
  ledgerVersion: number;
  group: { name: string; currency: string; status: string };
  balances: { userId: string; net: number }[];
  settlement: { method: string; transfers: { fromUserId: string; toUserId: string; amount: number }[] };
  pendingPayments: unknown[];
}

async function main() {
  const login = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const auth = await login.json();
  if (!login.ok) throw new Error(auth.error);

  const loadGroup = async () => {
    const res = await fetch(`${apiUrl}/api/groups/${groupId}`, { headers: { authorization: `Bearer ${auth.token}` } });
    if (!res.ok) throw new Error(`Can't read group ${groupId}`);
    return (await res.json()).group;
  };
  const group = await loadGroup();
  let names = new Map<string, string>();
  const setNames = (g: { members: { userId: string; name: string }[] }) => {
    names = new Map(g.members.map((m) => [m.userId, m.name]));
  };
  setNames(group);
  const name = (id: string) => names.get(id) ?? id.slice(0, 8);
  const fail = (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  };

  const socket = io(apiUrl, { auth: { token: auth.token } });
  const print = (u: Update) => {
    const what = u.change ? `${u.change.type} by ${name(u.change.actorId)}` : "current state";
    console.log(`\n[${new Date().toLocaleTimeString()}] ${what}  (ledgerVersion ${u.ledgerVersion}, ${u.group.status})`);
    for (const b of u.balances) console.log(`  ${name(b.userId).padEnd(12)} ${b.net > 0 ? "+" : ""}${b.net}`);
    const plan = u.settlement.transfers.map((t) => `${name(t.fromUserId)} → ${name(t.toUserId)} ${t.amount}`);
    console.log(`  settlement (${u.settlement.method}): ${plan.join(", ") || "all settled"}`);
    if (u.pendingPayments.length) console.log(`  pending payments: ${u.pendingPayments.length}`);
  };

  socket.on("connect", () => {
    // Re-join on every (re)connect; the ack includes the current snapshot.
    socket
      .timeout(5000)
      .emitWithAck("group:join", groupId)
      .then((res) => {
        if (!res.ok) throw new Error(res.error);
        console.log(`Watching "${group.name}" as ${auth.user.name}. Amounts are in minor units (${group.currency}). Ctrl+C to stop.`);
        print(res.update);
      })
      .catch(fail);
  });
  socket.on("group:update", (u: Update) => {
    if (u.change?.type !== "member.joined") return print(u);
    loadGroup().then(setNames).then(() => print(u)).catch(fail);
  });
  socket.on("connect_error", (e) => console.error(`connect error: ${e.message}`));
  socket.on("disconnect", (why) => console.error(`disconnected: ${why}`));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
