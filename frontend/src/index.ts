/**
 * Frontend Master Client Entry Point
 * Tagoloan Water District Real-Time Water Meter Reading System
 */

export const FRONTEND_META = {
  name: "Tagoloan Water District Client Portal",
  version: "1.0.0",
  framework: "React 19 + Vite + Tailwind CSS",
  port: 3000,
  routes: [
    "/ (Landing & Public Directory)",
    "/login (Dual Consumer & Employee Gate)",
    "/register (New Service Application)",
    "/portal/consumer (Account Billing & Consumption Telemetry)",
    "/portal/admin (Billing Operations, Grace Periods & Disconnection Scanner)",
  ],
};
