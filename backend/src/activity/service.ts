import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/errors";

// A group's activity log, newest first (D22). Paged by keyset on
// (createdAt, id) rather than by offset, so entries added while someone is
// paging can't shift the pages and cause duplicates or gaps.
// `before` is the id of the last entry on the previous page.
export async function listActivity(groupId: string, opts: { limit: number; before?: string }) {
  let where: Prisma.ActivityWhereInput = { groupId };
  if (opts.before) {
    const cursor = await prisma.activity.findFirst({
      where: { id: opts.before, groupId },
      select: { id: true, createdAt: true },
    });
    // Unknown ids and ids from other groups look the same.
    if (!cursor) throw new HttpError(400, "Invalid cursor");
    where = {
      groupId,
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }

  const rows = await prisma.activity.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1, // one extra to tell whether another page exists
    include: { actor: { select: { id: true, name: true } } },
  });
  const page = rows.slice(0, opts.limit);
  return {
    activities: page.map((a) => ({
      id: a.id,
      type: a.type,
      actor: a.actor,
      data: a.data,
      createdAt: a.createdAt.toISOString(),
    })),
    nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null,
  };
}
