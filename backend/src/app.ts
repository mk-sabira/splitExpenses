import cors from "cors";
import express from "express";
import { authRouter } from "./auth/routes";
import { config } from "./config";
import { expensesRouter } from "./expenses/routes";
import { groupsRouter } from "./groups/routes";
import { invitesRouter } from "./invites/routes";
import { balancesRouter, settlementRouter } from "./ledger/routes";
import { groupPaymentsRouter, paymentsRouter } from "./payments/routes";
import { errorHandler, HttpError } from "./lib/errors";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/invites", invitesRouter);
  app.use("/api/groups/:groupId/expenses", expensesRouter);
  app.use("/api/groups/:groupId/balances", balancesRouter);
  app.use("/api/groups/:groupId/settlement", settlementRouter);
  app.use("/api/groups/:groupId/payments", groupPaymentsRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/groups", groupsRouter);

  app.use((_req, _res) => {
    throw new HttpError(404, "Not found");
  });
  app.use(errorHandler);
  return app;
}
