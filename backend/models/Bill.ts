export interface BillModel {
  id: string;
  accountNumber: string;
  readingId: string;
  billingMonth: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  disconnectionDate: string;
  cubicMetersUsed: number;
  basicCharge: number;
  franchiseTax: number;
  maintenanceFee: number;
  surcharge: number;
  totalAmount: number;
  amountPaid: number;
  paymentStatus: "unpaid" | "partially_paid" | "paid" | "overdue";
  status: "verified" | "pending";
}
