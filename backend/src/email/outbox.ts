import type { EmailKind, Prisma } from "@prisma/client";

export interface Email {
  to: string;
  subject: string;
  body: string;
  kind: EmailKind;
}

// Email stub (D11): nothing is delivered. The email is stored in EmailOutbox
// inside the caller's transaction, so it exists only if the change that caused
// it is saved. Call logEmails() after the transaction commits.
export async function queueEmail(tx: Prisma.TransactionClient, email: Email) {
  await tx.emailOutbox.create({ data: email });
  return email;
}

export function logEmails(emails: Email[]) {
  if (process.env.NODE_ENV === "test") return;
  for (const e of emails) {
    console.log(`[email:${e.kind}] to=${e.to} subject=${JSON.stringify(e.subject)}\n${e.body}\n`);
  }
}
