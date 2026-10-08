import { Router } from "express";
import { reportController } from "../controllers/reportController.ts";

export const reportRouter = Router();

reportRouter.get("/monthly", reportController.getMonthlySummary);
