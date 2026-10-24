/**
 * Frontend Services Catalog
 * Handles communication with backend API, Firebase Firestore, and real-time sockets.
 */

export const SERVICES_CATALOG = {
  apiClient: "RESTful HTTP communication layer with automatic retries and token headers",
  firebaseDb: "Cloud Firestore reactive live listeners with fallback local cache",
  realtimeSocket: "Telemetry stream for meter reads and urgent disconnection notices",
};
