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

// A bad value would make setInterval fire every millisecond, so fail fast.
const reminderIntervalMs = Number(process.env.REMINDER_INTERVAL_MS ?? 60 * 60 * 1000);
if (!Number.isInteger(reminderIntervalMs) || reminderIntervalMs < 1000) {
  throw new Error("REMINDER_INTERVAL_MS must be a whole number of milliseconds, at least 1000");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret,
  jwtExpiresIn: "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Base URL of the frontend, used for links in emails.
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  // How often the debtor reminder job checks for due reminders (D19).
  reminderIntervalMs,
} as const;
