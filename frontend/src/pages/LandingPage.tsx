import { useState, type SubmitEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { ApiError, errorMessage } from "../lib/api";
import {
  Button,
  Card,
  Choice,
  Highlight,
  Notice,
  TextField,
  Wordmark,
} from "../ui";
import { GuideJourney } from "./HelpPage";

// The logged-out front page: what Esep is, how to use it in five steps, and
// the log-in / sign-up form.

type Mode = "login" | "register";

export function LandingPage({ mode }: { mode: Mode }) {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <main className="mx-auto grid max-w-6xl gap-x-12 gap-y-12 px-4 pt-10 pb-20 sm:px-6 md:grid-cols-12 md:pt-14">
        <section className="md:col-span-7">
          <Wordmark size="lg" />
          <h1 className="mt-6 max-w-xl font-hand text-3xl leading-tight font-bold sm:text-4xl">
            Shared costs, <Highlight>kept friendly</Highlight>.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-ink-soft">
            Esep keeps track of who paid for what on trips, in shared flats and at dinners, then tells everyone
            exactly how to settle up.
          </p>
        </section>

        <div className="md:col-span-5 md:row-span-2">
          <AuthCard mode={mode} />
        </div>

        <section className="md:col-span-7" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="mb-6 font-hand text-3xl font-bold">
            How it works
          </h2>
          <GuideJourney />
        </section>
      </main>
    </div>
  );
}

function AuthCard({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { login, register } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const invited = params.get("next")?.match(/^\/(join|invites)\//);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const switchMode = (m: Mode) => {
    setError(null);
    setFields({});
    navigate({ pathname: m === "login" ? "/login" : "/register", search: params.toString() });
  };

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      // <RedirectIfAuthenticated> takes it from here.
    } catch (err) {
      const f = err instanceof ApiError ? err.fields : {};
      setFields(f);
      setError(Object.keys(f).length > 0 ? null : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card tilt={0} tape="marker" className="md:sticky md:top-10">
      {invited && (
        <p className="mb-3 font-hand text-xl">
          <Highlight>You've been invited!</Highlight> Log in or sign up to join the group.
        </p>
      )}
      <Choice<Mode>
        legend={<span className="sr-only">Log in or sign up</span>}
        value={mode}
        onChange={switchMode}
        options={[
          { value: "login", label: <span className="text-2xl font-bold">log in</span> },
          { value: "register", label: <span className="text-2xl font-bold">sign up</span> },
        ]}
      />
      <form className="mt-4 space-y-5" onSubmit={submit}>
        {mode === "register" && (
          <TextField
            label="Your name"
            autoComplete="name"
            required
            maxLength={100}
            value={form.name}
            onChange={set("name")}
            error={fields.name}
          />
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={set("email")}
          error={fields.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "register" ? 8 : undefined}
          hint={mode === "register" ? "At least 8 characters." : undefined}
          value={form.password}
          onChange={set("password")}
          error={fields.password}
        />
        {error && <Notice>{error}</Notice>}
        <Button variant="primary" type="submit" className="w-full" disabled={busy}>
          {busy ? (mode === "login" ? "Logging in…" : "Creating your account…") : mode === "login" ? "Log in" : "Create my account"}
        </Button>
      </form>
      {!invited && (
        <p className="mt-5 text-sm text-ink-soft">
          Got an invite link? Open it and you'll come back to the group after logging in.
        </p>
      )}
    </Card>
  );
}
