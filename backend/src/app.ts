import path from "node:path";
import cors from "cors";
import express from "express";
import { activityRouter } from "./activity/routes";
import { authRouter } from "./auth/routes";
import { config } from "./config";
import { expensesRouter } from "./expenses/routes";
import { groupsRouter } from "./groups/routes";
import { invitesRouter } from "./invites/routes";
import { balancesRouter, settlementRouter } from "./ledger/routes";
import { notificationsRouter } from "./notifications/routes";
import { groupPaymentsRouter, paymentsRouter } from "./payments/routes";
import { errorHandler, HttpError } from "./lib/errors";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  // Dev-only page for manually testing real-time sync (see README).
  if (process.env.NODE_ENV !== "production") {
    app.get("/dev/realtime", (_req, res) => {
      res.sendFile(path.join(__dirname, "../dev/realtime.html"));
    });
  }

  app.use("/api/auth", authRouter);
  app.use("/api/invites", invitesRouter);
  app.use("/api/groups/:groupId/expenses", expensesRouter);
  app.use("/api/groups/:groupId/balances", balancesRouter);
  app.use("/api/groups/:groupId/settlement", settlementRouter);
  app.use("/api/groups/:groupId/payments", groupPaymentsRouter);
  app.use("/api/groups/:groupId/activity", activityRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/groups", groupsRouter);

  app.use((_req, _res) => {
    throw new HttpError(404, "Not found");
  });
  app.use(errorHandler);
  return app;
}
