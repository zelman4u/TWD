export interface ConsumerModel {
  accountNumber: string;
  name: string;
  address: string;
  barangay: string;
  barangayId?: string;
  sitioZone: string;
  meterNumber: string;
  previousReading: number;
  lastReadingDate: string;
  meterSize: string;
  consumerType: "Residential" | "Commercial";
  status: "active" | "disconnected" | "maintenance" | "pending" | "Disconnection Notice";
  contactNumber?: string;
  email?: string;
  rfidTag?: string;
  qrCode?: string;
  registrationDate?: string;
  linkedUserId?: string;
}
