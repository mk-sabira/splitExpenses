import { useState, type SubmitEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDay } from "../lib/time";
import type { GroupDetail } from "../lib/types";
import { useAction } from "../lib/useAction";
import { Button, Notice, TextField } from "../ui";
import { RoughLayer, useSeed } from "../ui/rough";
import { MemberAvatar, useGroup } from "./context";

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
              <InviteByEmail pending={detail.pendingInvites} />
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

// A personal invite (D16): only the account with this email can accept it.
function InviteByEmail({ pending }: { pending: GroupDetail["pendingInvites"] }) {
  const { groupId, afterChange } = useGroup();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const action = useAction();

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setFieldError(undefined);
    setSentTo(null);
    let onField = false;
    const ok = await action.run(async () => {
      try {
        const { invite } = await api<{ invite: { email: string } }>(`/groups/${groupId}/invites`, {
          method: "POST",
          body: { email },
        });
        setSentTo(invite.email);
        setEmail("");
      } catch (err) {
        if (err instanceof ApiError && err.fields.email) {
          setFieldError(err.fields.email);
          onField = true;
        }
        throw err;
      }
      await afterChange(); // reloads the group, so the pending list below includes it
    });
    if (!ok && onField) action.setError(null); // the field already says what's wrong
  }

  return (
    <div className="mt-5">
      <p className="font-hand text-lg text-ink-soft">Or invite by email</p>
      <form onSubmit={submit} className="mt-1 flex flex-wrap items-start gap-3" noValidate>
        <div className="min-w-0 flex-1">
          <TextField
            label={<span className="sr-only">Email address to invite</span>}
            type="email"
            placeholder="friend@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError}
          />
        </div>
        <Button type="submit" disabled={action.busy || email.trim() === ""} className="mt-1 text-base">
          {action.busy ? "Sending…" : "Send invite"}
        </Button>
      </form>
      {action.error && (
        <div className="mt-2">
          <Notice>{action.error}</Notice>
        </div>
      )}
      {sentTo && (
        <p role="status" className="mt-2 text-sm">
          ✓ Invite sent to <span className="font-medium">{sentTo}</span>. Email isn't really sent in this project:
          the backend prints it, with the link to accept, in its console.
        </p>
      )}
      {pending.length > 0 && (
        <div className="mt-3 text-sm text-ink-soft">
          <p>Invited, not joined yet:</p>
          <ul className="mt-1 space-y-0.5" aria-label="Pending invites">
            {pending.map((p) => (
              <li key={p.id}>
                {p.email} <span className="text-ink-faint">· expires {formatDay(p.expiresAt.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
