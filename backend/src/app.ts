import cors from "cors";
import express from "express";
import { authRouter } from "./auth/routes";
import { config } from "./config";
import { errorHandler, HttpError } from "./lib/errors";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);

  app.use((_req, _res) => {
    throw new HttpError(404, "Not found");
  });
  app.use(errorHandler);
  return app;
}
