import { useState } from "react";
import type { GroupDetail } from "../lib/types";
import { Button, Card } from "../ui";
import { MemberAvatar } from "./context";

// Who's in the group, and the link to bring more people in.
export function MembersCard({ detail, closed }: { detail: GroupDetail; closed: boolean }) {
  const [copied, setCopied] = useState(false);
  // The backend builds the link from its APP_URL; use this site's own origin so
  // it works wherever the frontend is actually served.
  const link = `${window.location.origin}/join/${detail.inviteToken}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is selectable on screen anyway */
    }
  }

  return (
    <Card title="Members" tone="lilac" tape="sky" tilt={-0.4}>
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {detail.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2">
            <MemberAvatar userId={m.userId} size={28} />
            <span>
              {m.name}
              {m.role === "OWNER" && <span className="ml-1 font-hand text-ink-soft">(owner)</span>}
            </span>
          </li>
        ))}
      </ul>
      {!closed && (
        <div className="mt-4">
          <p className="font-hand text-lg text-ink-soft">Invite with this link</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 truncate rounded-sm bg-paper/70 px-2 py-1 text-sm" title={link}>
              {link}
            </code>
            <Button onClick={copy} className="text-base">
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
