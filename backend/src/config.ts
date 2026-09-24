// Reads and validates environment variables once at startup, so a missing
// setting fails fast instead of surfacing later as a confusing runtime error.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret,
  jwtExpiresIn: "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
} as const;
