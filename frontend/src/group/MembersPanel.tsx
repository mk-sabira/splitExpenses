import { useState } from "react";
import type { GroupDetail } from "../lib/types";
import { Button } from "../ui";
import { RoughLayer, useSeed } from "../ui/rough";
import { MemberAvatar } from "./context";

// Who's in the group, and the link to bring more people in. Folded away under
// the group's name: most visits are about money, not the member list. It starts
// open while you're the only member, since inviting is the next thing to do.
export function MembersPanel({ detail, closed }: { detail: GroupDetail; closed: boolean }) {
  const [copied, setCopied] = useState(false);
  const seed = useSeed();
  // The backend builds the link from its APP_URL; use this site's own origin so
  // it works wherever the frontend is actually served.
  const link = `${window.location.origin}/join/${detail.inviteToken}`;
  const alone = detail.members.length === 1;

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
    <details open={alone && !closed} className="group/members max-w-2xl">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 font-hand text-lg text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex -space-x-2">
          {detail.members.slice(0, 5).map((m) => (
            <MemberAvatar key={m.userId} userId={m.userId} size={26} />
          ))}
        </span>
        {closed ? "Members" : "Members & invite"}
        <span aria-hidden className="inline-block transition-transform group-open/members:rotate-90">
          ›
        </span>
      </summary>
      <div className="relative mt-3 px-4 pt-3 pb-4">
        <RoughLayer shape={{ kind: "rect" }} seed={seed} strokeWidth={1.2} roughness={1.5} fill="var(--color-lilac)" fillStyle="solid" />
        <div className="relative">
          <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Members">
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
        </div>
      </div>
    </details>
  );
}
