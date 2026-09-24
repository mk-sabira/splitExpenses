import { randomBytes } from "node:crypto";
import type { GroupStatus } from "@prisma/client";
import { signToken } from "../src/auth/tokens";
import { prisma } from "../src/db";

// Every test file uses its own email suffix, and cleanup() deletes only rows
// created under it, so test files can run in parallel against the dev database.
export function uniqueSuffix(label: string) {
  return `-${Date.now()}-${randomBytes(3).toString("hex")}@${label}.test.local`;
}

export interface TestUser {
  id: string;
  name: string;
  auth: { Authorization: string };
}

// Created directly in the database: skips bcrypt, which is slow and covered by the auth tests.
export async function createUsers(suffix: string, names: string[]): Promise<TestUser[]> {
  const users: TestUser[] = [];
  for (const name of names) {
    const user = await prisma.user.create({
      data: { email: `${name.toLowerCase()}${suffix}`, name, passwordHash: "unused" },
    });
    users.push({ id: user.id, name, auth: { Authorization: `Bearer ${signToken(user.id)}` } });
  }
  return users;
}

// Members join in the order given, one minute apart, which sets the rounding tie-break order (D5).
export async function createGroup(
  members: TestUser[],
  opts: { status?: GroupStatus; currency?: string } = {},
) {
  const base = Date.parse("2026-01-01T00:00:00Z");
  return prisma.group.create({
    data: {
      name: "Test group",
      currency: opts.currency ?? "EUR",
      status: opts.status ?? "OPEN",
      inviteToken: randomBytes(16).toString("hex"),
      createdById: members[0].id,
      members: {
        create: members.map((m, i) => ({
          userId: m.id,
          role: i === 0 ? "OWNER" : "MEMBER",
          joinedAt: new Date(base + i * 60_000),
        })),
      },
    },
  });
}

export async function cleanup(suffix: string) {
  const where = { email: { endsWith: suffix } };
  // Deleting groups cascades to members, expenses, splits, payments and activity.
  await prisma.group.deleteMany({ where: { createdBy: where } });
  await prisma.user.deleteMany({ where });
  // Stub emails aren't linked to a group or user, so match on the recipient.
  await prisma.emailOutbox.deleteMany({ where: { to: { endsWith: suffix } } });
}

// Small seeded PRNG (mulberry32), so a failing random test can be replayed exactly.
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: T[]) => xs[int(0, xs.length - 1)];
  const subset = <T>(xs: T[]) => {
    const chosen = xs.filter(() => next() < 0.6);
    return chosen.length > 0 ? chosen : [pick(xs)];
  };
  const shuffle = <T>(xs: T[]) => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return { next, int, pick, subset, shuffle };
}
