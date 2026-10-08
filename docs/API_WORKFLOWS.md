# Tagoloan Water District - API & Data Workflows

## 1. Meter Reading Telemetry Flow
```text
[Mobile Meter Reader App]
       │
       ▼
(Offline Storage Queue) ───[Network Restored]───► POST /api/readings/submit
                                                           │
                                                           ▼
                                               [backend/services/tariffService.ts]
                                                           │ (computes tiered consumption)
                                                           ▼
                                               [database/meter_readings]
                                                           │
                                                           ▼
                                                POST /api/readings/:id/verify (Admin staff)
                                                           │
                                                           ▼
                                               [database/billing_statements]
```

## 2. 3-Month Grace Period & Disconnection Workflow
```text
[backend/services/gracePeriodService.ts]
       │
       ├── Scans all verified unpaid billing cycles
       │
       ├── Condition A: Days overdue >= 90 days?
       ├── Condition B: Unpaid cycles >= 3?
       │
       ▼
If Yes:
       ├── Updates status to 'Disconnection Notice'
       ├── Triggers urgent billing banner on Consumer Portal
       ├── Generates cutting order on Admin Dashboard
       └── Enforces 50% strict minimum partial payment rule
```
