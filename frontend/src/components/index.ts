/**
 * Frontend Component Registry
 * Organizes presentations, UI modals, dashboards, and graphs.
 */

export const COMPONENT_CATALOG = {
  portals: [
    "LandingPage",
    "UnifiedLogin",
    "RegistrationPage",
    "ConsumerPortal",
    "AdminPortal",
  ],
  adminModules: [
    "GracePeriodScanner",
    "DisconnectionListModal",
    "AuditTrailViewer",
    "MeterReadingBatchReviewer",
    "PaymentVerificationPanel",
  ],
  consumerModules: [
    "BillBreakdownCard",
    "PaymentReceiptUploader",
    "OverdueAlertBanner",
    "DueCountdownPill",
    "ConsumptionHistoryChart",
  ],
  charts: [
    "ConsumptionTrendLine",
    "BarangayUsageBarChart",
    "StatusDistributionPie",
  ],
};
