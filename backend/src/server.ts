import { createServer } from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { attachRealtime } from "./realtime";
import { startReminderScheduler } from "./reminders/scheduler";

const server = createServer(createApp());
attachRealtime(server);
startReminderScheduler({ intervalMs: config.reminderIntervalMs });
server.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  if (process.env.NODE_ENV !== "production") {
    console.log(`Real-time test page: http://localhost:${config.port}/dev/realtime`);
  }
});
