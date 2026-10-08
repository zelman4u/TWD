# Frontend Architecture Layer (React + Vite + Tailwind CSS)

This directory hosts the user interface and presentation components for the **Tagoloan Water District Real-Time Water Meter Reading System**.

## Directory Structure:
```text
frontend/
├── public/                 # Static assets and favicons
├── package.json            # Client dependencies and UI scripts
└── src/
    ├── main.tsx            # React application root entry point
    ├── App.tsx             # Master session supervisor and role router
    ├── types.ts            # Central TypeScript domain interfaces
    ├── index.css           # Tailwind styling with eye-friendly contrast
    │
    ├── components/         # Presentation and UI modules
    │   ├── LandingPage.tsx       # Official municipal public portal & FAQs
    │   ├── UnifiedLogin.tsx      # Dual-role authentication gate
    │   ├── RegistrationPage.tsx  # New service application form
    │   ├── AdminPortal.tsx       # Full administrative operations dashboard
    │   ├── ConsumerPortal.tsx    # Consumer self-service bills and telemetry
    │   ├── admin/                # Grace period scanner, reports, archives
    │   ├── consumer/             # Bill breakdowns, payment uploader, due alerts
    │   ├── common/               # Loading spinners, District profiles, skeletons
    │   └── charts/               # Consumption trends, barangay comparisons
    │
    ├── context/            # Global UI state (ToastContext, LoadingContext)
    ├── services/           # Data services (apiClient, firebaseDb, realtimeSocket)
    ├── utils/              # Pure calculations (tariffCalculator, identifierValidation)
    └── constants/          # District profiles, tariff schedules, storage keys
```

## Error Tracing Guide:
- **UI render or layout issue?** Trace to `frontend/src/components/`.
- **Toast or loading spinner error?** Trace to `frontend/src/context/`.
- **API or telemetry connection drop?** Trace to `frontend/src/services/`.
- **Tariff calculation discrepancy?** Trace to `frontend/src/utils/tariffCalculator.ts`.
