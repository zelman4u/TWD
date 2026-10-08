import { Request, Response } from "express";
import { successResponse, errorResponse } from "../utils/responseHelper.ts";
import { computeWaterTariff } from "../services/tariffService.ts";

export const readingController = {
  submitReading: async (req: Request, res: Response) => {
    try {
      const { accountNumber, previousReading, currentReading, consumerType } = req.body;
      const tariff = computeWaterTariff(
        Number(previousReading) || 0,
        Number(currentReading) || 0,
        consumerType || "Residential"
      );

      return successResponse(res, {
        id: `RD-${Date.now()}`,
        accountNumber,
        previousReading,
        currentReading,
        tariff,
        status: "pending_verification",
        submittedAt: new Date().toISOString()
      }, "Reading submitted for supervisor verification.", 201);
    } catch (err) {
      return errorResponse(res, "Failed to submit reading.", 500, err);
    }
  },

  verifyReading: async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      return successResponse(res, { id, status: status || "verified" }, "Reading verification updated.");
    } catch (err) {
      return errorResponse(res, "Verification failed.", 500, err);
    }
  }
};
