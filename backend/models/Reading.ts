export interface ReadingModel {
  id: string;
  accountNumber: string;
  consumerName: string;
  meterNumber: string;
  billingPeriod: string;
  readingDate: string;
  previousReading: number;
  currentReading: number;
  consumption: number;
  readerId: string;
  readerName: string;
  route: string;
  status: "pending_verification" | "verified" | "rejected";
  photoUrl?: string;
  coordinates?: { latitude: number; longitude: number };
  notes?: string;
  submittedAt: string;
}
