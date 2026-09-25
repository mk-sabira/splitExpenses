import { Link } from "react-router";
import { Card } from "../ui";

export function NotFound() {
  return (
    <Card title="Nothing here" className="max-w-md">
      <p className="text-ink-soft">
        That page doesn't exist. <Link to="/groups" className="text-ink underline decoration-1 underline-offset-4">Back to my groups</Link>
      </p>
    </Card>
  );
}
