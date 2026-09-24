import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError } from "../lib/errors";
import { requireAuth } from "./middleware";
import { hashPassword, verifyPassword } from "./password";
import { signToken } from "./tokens";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

// bcrypt ignores everything past 72 bytes, so longer passwords are rejected
// rather than silently truncated.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password must be at most 72 bytes");

const registerBody = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password,
});

const loginBody = z.object({
  email,
  password: z.string().min(1),
});

const publicUser = { id: true, email: true, name: true, createdAt: true } as const;

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const body = registerBody.parse(req.body);
  const passwordHash = await hashPassword(body.password);
  try {
    const user = await prisma.user.create({
      data: { email: body.email, name: body.name, passwordHash },
      select: publicUser,
    });
    res.status(201).json({ token: signToken(user.id), user });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, "An account with this email already exists");
    }
    throw err;
  }
});

authRouter.post("/login", async (req, res) => {
  const body = loginBody.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = await verifyPassword(body.password, user?.passwordHash ?? null);
  if (!user || !ok) throw new HttpError(401, "Invalid email or password");
  const { passwordHash: _, ...rest } = user;
  res.json({ token: signToken(user.id), user: rest });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: publicUser });
  if (!user) throw new HttpError(401, "Authentication required");
  res.json({ user });
});
