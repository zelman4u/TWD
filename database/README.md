# Database Architecture & Data Schema Layer

This folder isolates the database structures, security rules, seed registries, and connection management for the **Tagoloan Water District Real-Time Water Meter Reading System**.

## Contents:
- **`schema/schema.sql`**: Full Relational SQL schema for MySQL/PostgreSQL (consumers, meters, readings, barangays, bills, payments).
- **`rules/firestore.rules`**: Production Firestore access control and security rules.
- **`seeds/seedData.ts`**: Municipal service zones, barangay stations, and baseline tariff rate brackets.
- **`connection.ts`**: Storage health check and circuit-breaker failover manager.

## Key Relational Entities:
1. `consumers` - Master water utility service ledger with account number primary keys.
2. `water_meters` - Asset inventory tracking serial numbers, pipe sizes, and status.
3. `meter_readings` - Telemetry submissions from mobile field readers with GPS coordinates.
4. `billing_statements` - Computed monthly bills, consumption tariffs, and payment status.
5. `payment_records` - Official receipt (OR) payment transactions.
6. `disconnection_alerts` - Accounts reaching 90 days past due or 3+ unpaid cycles.
