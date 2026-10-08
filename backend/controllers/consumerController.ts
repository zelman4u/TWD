import { Request, Response } from "express";
import { successResponse, errorResponse } from "../utils/responseHelper.ts";

export const consumerController = {
  getAll: async (_req: Request, res: Response) => {
    try {
      return successResponse(res, [], "Fetched registered consumers successfully.");
    } catch (err) {
      return errorResponse(res, "Failed to fetch consumers.", 500, err);
    }
  },

  getByAccountNumber: async (req: Request, res: Response) => {
    try {
      const { accountNumber } = req.params;
      return successResponse(res, { accountNumber }, `Consumer record for ${accountNumber}`);
    } catch (err) {
      return errorResponse(res, "Consumer not found.", 404, err);
    }
  },

  create: async (req: Request, res: Response) => {
    try {
      const newConsumer = req.body;
      return successResponse(res, newConsumer, "Consumer registered successfully.", 201);
    } catch (err) {
      return errorResponse(res, "Registration failed.", 400, err);
    }
  }
};
