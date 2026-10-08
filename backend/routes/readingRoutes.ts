import { Router } from "express";
import { readingController } from "../controllers/readingController.ts";

export const readingRouter = Router();

readingRouter.post("/submit", readingController.submitReading);
readingRouter.patch("/:id/verify", readingController.verifyReading);
