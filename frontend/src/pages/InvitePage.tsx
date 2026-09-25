import { Navigate, useNavigate, useParams } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, errorMessage } from "../lib/api";
import type { GroupDetail } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useAction } from "../lib/useAction";
import { Button, Card, Highlight, Loading, Notice } from "../ui";
import { groupLine, InviteProblem, link } from "./JoinPage";

type Preview = {
  email: string;
  groupName: string;
  currency: string;
  memberCount: number;
  closed: boolean;
  invitedBy: string;
  expired: boolean;
  accepted: boolean;
  alreadyMember: boolean;
  groupId?: string; // only when you're already a member
};

// /invites/:token, a personal email invite (D16). Like the join link, it shows
// the group first; unlike it, only the account with the invited email can
// accept, so logging in and signing up both carry that address along.
export function InvitePage() {
  const { token } = useParams() as { token: string };
  const { state } = useAuth();
  const path = `/invites/email/${encodeURIComponent(token)}`;
  // Wait for the session, so a logged-in visitor's preview says whether they're already in.
  const preview = useApi<Preview>(state.status === "loading" ? null : path);

  if (state.status === "loading" || preview.status === "loading") return <Loading />;

  if (preview.status === "error") {
    const invalid = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <InviteProblem title={invalid ? "This invite doesn't work" : "Couldn't open this invite"}>
        {invalid
          ? "It may have been mistyped, or a newer invite replaced it. Check your email for the latest one, or ask for a fresh invite."
          : errorMessage(preview.error)}
      </InviteProblem>
    );
  }

  const p = preview.data;
  if (p.alreadyMember && p.groupId) return <Navigate to={`/groups/${p.groupId}`} replace />;
  if (p.expired && !p.accepted) {
    return (
      <InviteProblem title="This invite has expired">
        Invites last 7 days. Ask {p.invitedBy} to send you a new one.
      </InviteProblem>
    );
  }

  const me = state.status === "authenticated" ? state.user : null;
  const isInvitee = me !== null && me.email.toLowerCase() === p.email.toLowerCase();
  return (
    <div className="max-w-lg space-y-6">
      <h1 className="font-hand text-3xl font-bold sm:text-4xl">
        <Highlight>You're invited</Highlight>
      </h1>
      <Card title={p.groupName} tone="sticky" tape="marker">
        <p className="text-ink-soft">{groupLine(p)}</p>
        <p className="mt-2">
          {p.invitedBy} invited <span className="font-medium">{p.email}</span>.
        </p>
        <div className="mt-5">
          {p.closed ? (
            <Notice>This group is closed, so it isn't taking new members.</Notice>
          ) : me === null ? (
            <LogInFirst token={token} email={p.email} />
          ) : isInvitee ? (
            <AcceptButton token={token} />
          ) : (
            <WrongAccount token={token} invited={p.email} current={me.email} />
          )}
        </div>
      </Card>
    </div>
  );
}

const authUrl = (page: "login" | "register", token: string, email: string) =>
  `/${page}?next=${encodeURIComponent(`/invites/${token}`)}&email=${encodeURIComponent(email)}`;

function AcceptButton({ token }: { token: string }) {
  const navigate = useNavigate();
  const action = useAction();
  const accept = () =>
    action.run(async () => {
      const { group } = await api<{ group: GroupDetail }>(`/invites/email/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      navigate(`/groups/${group.id}`, { replace: true });
    });
  return (
    <div className="space-y-3">
      <p>Expenses you're part of will count towards your balance in this group.</p>
      <Button variant="primary" onClick={accept} disabled={action.busy}>
        {action.busy ? "Joining…" : "Accept and join"}
      </Button>
      {action.error && <Notice>{action.error}</Notice>}
    </div>
  );
}

function LogInFirst({ token, email }: { token: string; email: string }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <p>
        Log in or sign up as <span className="font-medium">{email}</span> to accept. You'll come straight back here.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={() => navigate(authUrl("login", token, email))}>
          Log in to accept
        </Button>
        <button type="button" onClick={() => navigate(authUrl("register", token, email))} className={link}>
          Sign up
        </button>
      </div>
    </div>
  );
}

// Logged in as someone else: only the invited address can accept (D16).
function WrongAccount({ token, invited, current }: { token: string; invited: string; current: string }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <Notice>
        This invite is for {invited}, and you're logged in as {current}. Only {invited} can accept it.
      </Notice>
      <p className="text-ink-soft">If that's you too, log out and log in or sign up with that address.</p>
      <Button
        onClick={() => {
          logout();
          navigate(authUrl("login", token, invited));
        }}
      >
        Log out and switch
      </Button>
    </div>
  );
}
