import { Router } from "express";
import { billingController } from "../controllers/billingController.ts";

export const billingRouter = Router();

billingRouter.get("/:accountNumber", billingController.getConsumerBills);
billingRouter.post("/payment", billingController.recordPayment);
