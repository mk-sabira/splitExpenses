// Test helper for the frontend end-to-end tests: prints the token of the
// latest email invite sent to an @e2e.test.local address (the tests can't
// read the stubbed email), or with --expire, moves its expiry into the past.
//   npx tsx --env-file=.env scripts/e2e-invite.ts <email> [--expire]
import { prisma } from "../src/db";

async function main() {
  const [email, flag] = process.argv.slice(2);
  if (!email?.endsWith("@e2e.test.local")) throw new Error("Only e2e test addresses");
  const invite = await prisma.groupInvite.findFirstOrThrow({ where: { email }, orderBy: { createdAt: "desc" } });
  if (flag === "--expire") {
    await prisma.groupInvite.update({ where: { id: invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  }
  process.stdout.write(invite.token);
}

main().finally(() => prisma.$disconnect());
