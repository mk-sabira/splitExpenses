import { Link } from "react-router";
import { Card } from "../ui";

// Stand-in for screens built in later milestones.
export function Placeholder({ title }: { title: string }) {
  return (
    <Card title={title} className="max-w-md">
      <p className="text-ink-soft">This screen comes in a later milestone.</p>
    </Card>
  );
}

export function NotFound() {
  return (
    <Card title="Nothing here" className="max-w-md">
      <p className="text-ink-soft">
        That page doesn't exist. <Link to="/groups" className="text-ink underline decoration-1 underline-offset-4">Back to my groups</Link>
      </p>
    </Card>
  );
}
