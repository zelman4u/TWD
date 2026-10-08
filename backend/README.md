# Backend Architecture Layer (Node.js + Express)

This directory hosts the RESTful API, authentication layer, business rules, calculation services, and database controllers for the **Tagoloan Water District Real-Time Water Meter Reading System**.

## Directory Structure:
```text
backend/
├── config/             # Environment, DB connections, and business thresholds
│   ├── env.ts          # Server port, thresholds, rates
│   └── constants.ts    # Official district details & minimum fees
├── controllers/        # Request/response controllers
│   ├── authController.ts
│   ├── consumerController.ts
│   ├── readingController.ts
│   ├── billingController.ts
│   └── reportController.ts
├── models/             # Data structure interfaces & validations
│   ├── Consumer.ts
│   ├── Reading.ts
│   ├── Bill.ts
│   └── Staff.ts
├── routes/             # RESTful endpoint definitions
│   ├── authRoutes.ts
│   ├── consumerRoutes.ts
│   ├── readingRoutes.ts
│   ├── billingRoutes.ts
│   ├── reportRoutes.ts
│   └── index.ts        # Master router
├── middlewares/        # Security, validation, and error management
│   ├── authMiddleware.ts
│   ├── validationMiddleware.ts
│   └── errorHandler.ts
├── services/           # Core utility business logic
│   ├── tariffService.ts        # Water consumption stepped calculations
│   ├── gracePeriodService.ts   # 3-Month overdue & disconnection engine
│   └── notificationService.ts  # Alerts & notices
├── utils/              # Helper utilities
│   ├── logger.ts
│   └── responseHelper.ts
└── server.ts           # Express application initializer
```

## Error Tracing Guide:
- **Tariff calculation discrepancy?** Trace to `backend/services/tariffService.ts`.
- **3-Month disconnection cutting notice issue?** Trace to `backend/services/gracePeriodService.ts`.
- **Reading validation or verification rejection?** Trace to `backend/controllers/readingController.ts`.
- **API route 404 or bad parameter?** Trace to `backend/routes/` and `backend/middlewares/validationMiddleware.ts`.
