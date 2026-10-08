import { Request, Response } from "express";
import { successResponse, errorResponse } from "../utils/responseHelper.ts";

export const billingController = {
  getConsumerBills: async (req: Request, res: Response) => {
    try {
      const { accountNumber } = req.params;
      return successResponse(res, [], `Billing statements for account ${accountNumber}`);
    } catch (err) {
      return errorResponse(res, "Failed to retrieve billing records.", 500, err);
    }
  },

  recordPayment: async (req: Request, res: Response) => {
    try {
      const { accountNumber, orNumber, amount, paymentMethod } = req.body;
      return successResponse(res, {
        id: `PAY-${Date.now()}`,
        accountNumber,
        orNumber,
        amount,
        paymentMethod,
        receiptDate: new Date().toISOString()
      }, "Payment recorded successfully.", 201);
    } catch (err) {
      return errorResponse(res, "Payment failed.", 400, err);
    }
  }
};
