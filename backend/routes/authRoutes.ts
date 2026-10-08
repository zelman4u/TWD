import { Router } from "express";
import { authController } from "../controllers/authController.ts";

export const authRouter = Router();

authRouter.post("/login", authController.login);
authRouter.get("/verify", authController.verifySession);
