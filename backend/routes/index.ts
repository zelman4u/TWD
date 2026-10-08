import { Router } from "express";
import { authRouter } from "./authRoutes.ts";
import { consumerRouter } from "./consumerRoutes.ts";
import { readingRouter } from "./readingRoutes.ts";
import { billingRouter } from "./billingRoutes.ts";
import { reportRouter } from "./reportRoutes.ts";

export const masterApiRouter = Router();

masterApiRouter.use("/auth", authRouter);
masterApiRouter.use("/consumers", consumerRouter);
masterApiRouter.use("/readings", readingRouter);
masterApiRouter.use("/billing", billingRouter);
masterApiRouter.use("/reports", reportRouter);

masterApiRouter.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "Tagoloan Water District Backend API Hub",
    timestamp: new Date().toISOString()
  });
});
