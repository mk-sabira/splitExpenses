import type { ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, errorMessage } from "../lib/api";
import { currencies } from "../lib/currencies";
import type { GroupDetail } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useAction } from "../lib/useAction";
import { Button, Card, Highlight, Loading, Notice } from "../ui";

type Preview = {
  groupName: string;
  currency: string;
  memberCount: number;
  closed: boolean;
  alreadyMember: boolean;
  groupId?: string; // only when you're already a member
};

export const link = "font-hand text-lg underline decoration-accent decoration-2 underline-offset-4";

// "EUR (Euro) · 3 members"
export function groupLine(p: { currency: string; memberCount: number }) {
  const name = currencies().find((c) => c.code === p.currency)?.name;
  return `${p.currency}${name ? ` (${name})` : ""} · ${p.memberCount} ${p.memberCount === 1 ? "member" : "members"}`;
}

// A link or invite that can't be used: says why, and where to go instead.
export function InviteProblem({ title, children }: { title: string; children: ReactNode }) {
  const { state } = useAuth();
  const in_ = state.status === "authenticated";
  return (
    <Card title={title} tone="blush" className="max-w-lg">
      <p className="text-ink-soft">{children}</p>
      <p className="mt-4">
        <Link to={in_ ? "/groups" : "/login"} className={link}>
          {in_ ? "Go to my groups" : "Go to the front page"}
        </Link>
      </p>
    </Card>
  );
}

// /join/:token, the group's shareable link (D16). Public: shows which group
// it is before anyone logs in, then asks to log in or sign up (coming back
// here through ?next=), and joins only when you say so.
export function JoinPage() {
  const { token } = useParams() as { token: string };
  const { state } = useAuth();
  // Wait for the session, so a logged-in visitor's preview says whether they're already in.
  const preview = useApi<Preview>(state.status === "loading" ? null : `/invites/link/${encodeURIComponent(token)}`);

  if (state.status === "loading" || preview.status === "loading") return <Loading />;

  if (preview.status === "error") {
    const invalid = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <InviteProblem title={invalid ? "This invite link doesn't work" : "Couldn't open this invite"}>
        {invalid
          ? "It may have been mistyped, or the group's owner replaced it with a new one. Ask whoever sent it for a fresh link."
          : errorMessage(preview.error)}
      </InviteProblem>
    );
  }

  const p = preview.data;
  if (p.alreadyMember && p.groupId) return <Navigate to={`/groups/${p.groupId}`} replace />;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="font-hand text-3xl font-bold sm:text-4xl">
        <Highlight>You're invited</Highlight>
      </h1>
      <Card title={p.groupName} tone="sticky" tape="marker">
        <p className="text-ink-soft">{groupLine(p)}</p>
        <div className="mt-5">
          {p.closed ? (
            <Notice>This group is closed, so it isn't taking new members.</Notice>
          ) : state.status === "authenticated" ? (
            <JoinButton token={token} />
          ) : (
            <LogInFirst token={token} />
          )}
        </div>
      </Card>
    </div>
  );
}

function JoinButton({ token }: { token: string }) {
  const navigate = useNavigate();
  const action = useAction();

  const join = () =>
    action.run(async () => {
      const { group } = await api<{ group: GroupDetail }>(`/invites/link/${encodeURIComponent(token)}/join`, { method: "POST" });
      navigate(`/groups/${group.id}`, { replace: true });
    });

  return (
    <div className="space-y-3">
      <p>Expenses you're part of will count towards your balance in this group.</p>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={join} disabled={action.busy}>
          {action.busy ? "Joining…" : "Join group"}
        </Button>
        <Link to="/groups" className="font-hand text-lg text-ink-soft hover:text-ink">
          Not now
        </Link>
      </div>
      {action.error && <Notice>{action.error}</Notice>}
    </div>
  );
}

function LogInFirst({ token }: { token: string }) {
  const navigate = useNavigate();
  const next = encodeURIComponent(`/join/${token}`);
  return (
    <div className="space-y-3">
      <p>Log in or sign up to join. You'll come straight back here.</p>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={() => navigate(`/login?next=${next}`)}>
          Log in to join
        </Button>
        <Link to={`/register?next=${next}`} className={link}>
          Sign up
        </Link>
      </div>
    </div>
  );
}
