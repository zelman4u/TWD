import { BillModel } from "../models/Bill.ts";

export interface GracePeriodEvaluation {
  shouldDisconnect: boolean;
  unpaidCycles: number;
  oldestOverdueDate: string | null;
  daysOverdue: number;
  totalOverdueAmount: number;
  recommendedStatus: "active" | "Disconnection Notice";
}

export function evaluateGracePeriod(
  accountNumber: string,
  unpaidBills: BillModel[],
  now = new Date()
): GracePeriodEvaluation {
  const verifiedUnpaid = unpaidBills.filter(
    (b) => b.accountNumber === accountNumber && b.status === "verified" && b.paymentStatus !== "paid"
  );

  if (verifiedUnpaid.length === 0) {
    return {
      shouldDisconnect: false,
      unpaidCycles: 0,
      oldestOverdueDate: null,
      daysOverdue: 0,
      totalOverdueAmount: 0,
      recommendedStatus: "active"
    };
  }

  let oldestDate: Date | null = null;
  let totalBalance = 0;

  for (const bill of verifiedUnpaid) {
    const due = new Date(bill.dueDate);
    if (!oldestDate || due < oldestDate) {
      oldestDate = due;
    }
    const balance = Math.max(0, bill.totalAmount - (bill.amountPaid || 0));
    totalBalance += balance;
  }

  const daysOverdue = oldestDate ? Math.max(0, Math.floor((now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24))) : 0;
  const isGracePeriodExceeded = daysOverdue >= 90 || verifiedUnpaid.length >= 3;

  return {
    shouldDisconnect: isGracePeriodExceeded,
    unpaidCycles: verifiedUnpaid.length,
    oldestOverdueDate: oldestDate ? oldestDate.toISOString() : null,
    daysOverdue,
    totalOverdueAmount: parseFloat(totalBalance.toFixed(2)),
    recommendedStatus: isGracePeriodExceeded ? "Disconnection Notice" : "active"
  };
}
