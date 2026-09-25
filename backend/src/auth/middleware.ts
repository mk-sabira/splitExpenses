import type { RequestHandler } from "express";
import { HttpError } from "../lib/errors";
import { verifyToken } from "./tokens";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function userFrom(header: string | undefined) {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  return token ? verifyToken(token) : null;
}

// Requires "Authorization: Bearer <jwt>" and sets req.userId.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const userId = userFrom(req.headers.authorization);
  if (!userId) throw new HttpError(401, "Authentication required");
  req.userId = userId;
  next();
};

// For public endpoints that say a little more to a logged-in caller: sets
// req.userId when the token is valid, and otherwise carries on anonymously.
export const optionalAuth: RequestHandler = (req, _res, next) => {
  req.userId = userFrom(req.headers.authorization) ?? undefined;
  next();
};
