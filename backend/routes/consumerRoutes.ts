import { Router } from "express";
import { consumerController } from "../controllers/consumerController.ts";

export const consumerRouter = Router();

consumerRouter.get("/", consumerController.getAll);
consumerRouter.get("/:accountNumber", consumerController.getByAccountNumber);
consumerRouter.post("/", consumerController.create);
