// Deletes everything the frontend end-to-end tests created: their users all
// have emails ending in @e2e.test.local. Run by Playwright's global teardown.
import { prisma } from "../src/db";

const where = { email: { endsWith: "@e2e.test.local" } };

async function main() {
  // Deleting groups cascades to members, expenses, splits, payments and activity.
  const groups = await prisma.group.deleteMany({ where: { createdBy: where } });
  // Memberships and activity in other groups would block deleting the users.
  const users = await prisma.user.findMany({ where, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.activity.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.groupMember.deleteMany({ where: { userId: { in: ids } } });
  const deleted = await prisma.user.deleteMany({ where });
  await prisma.emailOutbox.deleteMany({ where: { to: { endsWith: "@e2e.test.local" } } });
  console.log(`[e2e-cleanup] removed ${deleted.count} users and ${groups.count} groups`);
}

main().finally(() => prisma.$disconnect());
