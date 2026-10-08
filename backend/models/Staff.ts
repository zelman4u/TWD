export interface StaffModel {
  id: string;
  username: string;
  name: string;
  role: "admin" | "meter_reader" | "billing_officer";
  zone?: string;
  contactNumber?: string;
  employmentStatus: "active" | "pending" | "inactive";
  registeredAt: string;
  assignedRoutes?: string[];
}
