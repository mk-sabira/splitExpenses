import jwt from "jsonwebtoken";
import { config } from "../config";

export function signToken(userId: string): string {
  return jwt.sign({}, config.jwtSecret, {
    algorithm: "HS256",
    subject: userId,
    expiresIn: config.jwtExpiresIn,
  });
}

// Returns the user id, or null if the token is invalid or expired.
export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
