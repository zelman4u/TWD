/**
 * Server Environment Configuration
 */
export const ENV_CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  DISCONNECTION_DAYS_THRESHOLD: 90,
  UNPAID_CYCLES_THRESHOLD: 3,
  LATE_PAYMENT_SURCHARGE_RATE: 0.10, // 10% penalty
  MINIMUM_PARTIAL_PAYMENT_PERCENT: 0.50 // 50% strict minimum
};
