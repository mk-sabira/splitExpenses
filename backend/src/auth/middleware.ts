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

// Requires "Authorization: Bearer <jwt>" and sets req.userId.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = token ? verifyToken(token) : null;
  if (!userId) throw new HttpError(401, "Authentication required");
  req.userId = userId;
  next();
};
