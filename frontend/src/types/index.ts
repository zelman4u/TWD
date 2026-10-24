/**
 * Frontend Domain Type Definitions
 */

export interface ConsumerAccount {
  accountNumber: string;
  name: string;
  address: string;
  barangay: string;
  meterNumber: string;
  previousReading: number;
  lastReadingDate: string;
  meterSize: string;
  isSeniorCitizen: boolean;
  contactNumber: string;
}

export interface BillingRecord {
  id: string;
  accountNumber: string;
  readingId: string;
  billingMonth: string;
  periodFrom: string;
  periodTo: string;
  dueDate: string;
  disconnectionDate: string;
  cubicMetersUsed: number;
  totalAmountDue: number;
  paymentStatus: "paid" | "unpaid" | "overdue" | "disconnection_scheduled";
}
