import bcrypt from "bcryptjs";

const COST = 12;

// Compared against when the email doesn't exist, so a failed login takes the
// same time whether or not the account exists (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH).then((ok) => ok && hash !== null);
}
