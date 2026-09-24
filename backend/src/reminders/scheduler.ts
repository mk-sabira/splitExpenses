import { sendDueReminders } from "./service";

// In-process interval job (D19). Runs once at start, then every `intervalMs`.
// A run that's still going when the next tick fires makes that tick a no-op,
// so runs never overlap. The clock is injectable so tests can simulate days
// passing without waiting for them.
export function startReminderScheduler(
  opts: { intervalMs: number; now?: () => Date; groupIds?: string[] },
) {
  const now = opts.now ?? (() => new Date());
  let running: Promise<void> | null = null;

  const tick = () => {
    if (running) return running;
    running = sendDueReminders(now(), { groupIds: opts.groupIds })
      .then(() => undefined)
      .catch((err) => console.error("[reminders] run failed:", err))
      .finally(() => {
        running = null;
      });
    return running;
  };

  void tick();
  const timer = setInterval(tick, opts.intervalMs);
  timer.unref();
  return {
    // Resolves when the in-flight run (if any) finishes.
    idle: () => running ?? Promise.resolve(),
    stop: () => clearInterval(timer),
  };
}
