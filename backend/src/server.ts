import { createServer } from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { attachRealtime } from "./realtime";

const server = createServer(createApp());
attachRealtime(server);
server.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  if (process.env.NODE_ENV !== "production") {
    console.log(`Real-time test page: http://localhost:${config.port}/dev/realtime`);
  }
});
