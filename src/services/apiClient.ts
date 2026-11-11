/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Tagoloan Water District - Resilient API Client Layer
 * Features comprehensive error logging, retry with exponential backoff,
 * response telemetry, and typed endpoints for seamless cross-module synchronization.
 */

export interface ApiLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  durationMs: number;
  success: boolean;
  retries: number;
  error?: string;
  responsePreview?: string;
}

export interface RequestOptions extends RequestInit {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  skipLogging?: boolean;
}

// In-memory log buffer for debugging & observability
const MAX_LOGS = 100;
const apiLogs: ApiLogEntry[] = [];
const logSubscribers = new Set<(log: ApiLogEntry) => void>();

export function subscribeApiLogs(callback: (log: ApiLogEntry) => void): () => void {
  logSubscribers.add(callback);
  return () => logSubscribers.delete(callback);
}

export function getApiLogs(): ApiLogEntry[] {
  return [...apiLogs];
}

function recordLog(entry: ApiLogEntry) {
  apiLogs.unshift(entry);
  if (apiLogs.length > MAX_LOGS) apiLogs.pop();
  logSubscribers.forEach(cb => {
    try { cb(entry); } catch {}
  });

  const icon = entry.success ? '✓' : '✗';
  const prefix = `[API Client ${icon}] ${entry.method} ${entry.url}`;
  if (entry.success) {
    if (entry.method !== 'GET') {
      console.info(
        `%c${prefix} %c${entry.status || 200} (${entry.durationMs}ms)${entry.retries > 0 ? ` [retries: ${entry.retries}]` : ''}`,
        'color: #059669; font-weight: bold;',
        'color: #64748b;'
      );
    }
  } else {
    console.warn(
      `%c${prefix} %c${entry.status || 'ERR'} (${entry.durationMs}ms) - ${entry.error || 'Request failed'}`,
      'color: #dc2626; font-weight: bold;',
      'color: #b91c1c;'
    );
  }
}

// Track API endpoints that returned 404 on static-only deployments or 429 rate-limit cooldowns
const unavailableApiRoutes = new Map<string, number>();
const rateLimitedRoutes = new Map<string, number>();
let backendStaticOnlyUntil = 0;
let globalRateLimitedUntil = 0;
let serverOverloadedUntil = 0;

export function isServerOverloaded(): boolean {
  return serverOverloadedUntil > Date.now();
}

export function markServerOverloaded(durationMs = 25000) {
  serverOverloadedUntil = Math.max(serverOverloadedUntil, Date.now() + durationMs);
}

const CORE_BACKEND_ROUTES = new Set([
  '/api/readings',
  '/api/billings',
  '/api/billings/reconcile',
  '/api/reports',
  '/api/readers',
  '/api/notifications',
  '/api/announcements',
  '/api/tariff-config',
  '/api/consumers',
  '/api/consumers/reconcile',
  '/api/consumers/resolve-account',
  '/api/consumers/change-password',
  '/api/installations',
  '/api/health',
]);

function normalizeApiRouteKey(url: string): string {
  return url.split('?')[0].replace(/\/+$/, '') || url;
}

function isRouteTemporarilyUnavailable(url: string): boolean {
  const now = Date.now();
  if (backendStaticOnlyUntil > now && url.startsWith('/api')) {
    return true;
  }
  const routeKey = normalizeApiRouteKey(url);
  const cooldownUntil = unavailableApiRoutes.get(routeKey);
  return Boolean(cooldownUntil && cooldownUntil > now);
}

function isRouteRateLimited(url: string): boolean {
  if (!url.startsWith('/api')) return false;
  const now = Date.now();
  if (globalRateLimitedUntil > now) return true;
  const routeKey = normalizeApiRouteKey(url);
  const routeCooldown = rateLimitedRoutes.get(routeKey);
  return Boolean(routeCooldown && routeCooldown > now);
}

function markRouteRateLimited(url: string, retryAfterHeader?: string | null) {
  const parsedSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const cooldownMs =
    Number.isFinite(parsedSec) && parsedSec > 0
      ? Math.min(30000, Math.max(5000, Math.ceil(parsedSec * 1000)))
      : 12000;
  const until = Date.now() + cooldownMs;
  const routeKey = normalizeApiRouteKey(url);
  rateLimitedRoutes.set(routeKey, until);
  globalRateLimitedUntil = Math.max(globalRateLimitedUntil, until);
}

function markRoute404(url: string, contentType: string) {
  // If the server returned a JSON 404 response, the backend API is alive and routing properly
  // (e.g. resource ID not found). Never trip static-host circuit breaking on JSON 404s.
  if (contentType && contentType.toLowerCase().includes('application/json')) {
    return;
  }
  const routeKey = normalizeApiRouteKey(url);
  const cooldownMs = 15 * 60 * 1000; // 15 minutes
  unavailableApiRoutes.set(routeKey, Date.now() + cooldownMs);
  if (CORE_BACKEND_ROUTES.has(routeKey)) {
    backendStaticOnlyUntil = Date.now() + cooldownMs;
  }
}

/**
 * Safe wrapper around fetch('/api/...') that respects static-host 404 & 429 cooldown circuit breaking
 * so background sync falls back silently to Cloud Firestore without spamming console errors.
 */
export async function safeBackendFetch(url: string, options?: RequestInit): Promise<Response | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;

  // Immediately fast-fail background sync if client is offline or server is overloaded
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null;
  }
  if (isRouteTemporarilyUnavailable(url) || isRouteRateLimited(url) || (url.startsWith('/api') && isServerOverloaded())) {
    return null;
  }

  try {
    const res = await fetch(url, options);
    if (res.status === 429) {
      markRouteRateLimited(url, res.headers.get('retry-after'));
      return null;
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      markServerOverloaded(25000);
      return null;
    }
    if (res.status === 404) {
      markRoute404(url, res.headers.get('content-type') || '');
      return null;
    }
    if (res.ok && url.startsWith('/api')) {
      const routeKey = normalizeApiRouteKey(url);
      unavailableApiRoutes.delete(routeKey);
      rateLimitedRoutes.delete(routeKey);
      backendStaticOnlyUntil = 0;
      serverOverloadedUntil = 0;
    }
    return res;
  } catch {
    return null;
  }
}

const inFlightGetRequests = new Map<string, Promise<any>>();
const inFlightReconcileRequests = new Map<string, Promise<any>>();

/**
 * Executes an HTTP fetch request with timeout, retries, and exponential backoff
 */
async function executeRequestWithRetry<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = ((options as any).method || 'GET').toUpperCase();
  const defaultRetries = method === 'GET' ? 2 : 0;
  const {
    retries = defaultRetries,
    retryDelayMs = 800,
    timeoutMs = 12000,
    skipLogging = false,
    ...fetchOptions
  } = options;

  const routeKey = normalizeApiRouteKey(url);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const offErr: any = new Error('Device is currently offline');
    offErr.isOffline = true;
    offErr.noRetry = true;
    throw offErr;
  }

  if (isRouteTemporarilyUnavailable(url)) {
    const cachedErr: any = new Error('Endpoint temporarily unavailable on static host');
    cachedErr.status = 404;
    cachedErr.noRetry = true;
    throw cachedErr;
  }

  if (isRouteRateLimited(url)) {
    const rateErr: any = new Error('Endpoint cooling down after HTTP 429');
    rateErr.status = 429;
    rateErr.isRateLimited = true;
    rateErr.noRetry = true;
    throw rateErr;
  }

  if (url.startsWith('/api') && isServerOverloaded()) {
    const busyErr: any = new Error('Server temporarily waking up or cooling down');
    busyErr.status = 502;
    busyErr.noRetry = true;
    throw busyErr;
  }

  const startTime = Date.now();
  let attempt = 0;
  let lastError: any = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Merge abort signals if one was already provided
    const userSignal = fetchOptions.signal;
    if (userSignal) {
      userSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      // Check if response is JSON or text
      const contentType = response.headers.get('content-type') || '';
      let data: any = null;
      let responseText = '';

      if (contentType.includes('application/json')) {
        data = await response.json();
        responseText = JSON.stringify(data).slice(0, 150);
      } else {
        responseText = await response.text();
        try {
          data = JSON.parse(responseText);
        } catch {
          data = responseText as any;
        }
      }

      // Success
      if (response.ok) {
        unavailableApiRoutes.delete(routeKey);
        rateLimitedRoutes.delete(routeKey);
        if (url.startsWith('/api')) {
          backendStaticOnlyUntil = 0;
        }
        if (!skipLogging) {
          recordLog({
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            method,
            url,
            status: response.status,
            durationMs,
            success: true,
            retries: attempt,
            responsePreview: responseText
          });
        }
        return data as T;
      }

      if (response.status === 429) {
        markRouteRateLimited(url, response.headers.get('retry-after'));
        const rateErr: any = new Error(`HTTP 429: ${data?.message || 'Too Many Requests'}`);
        rateErr.status = 429;
        rateErr.isRateLimited = true;
        rateErr.noRetry = true;
        rateErr.data = data;
        throw rateErr;
      }

      if (response.status === 404) {
        markRoute404(url, contentType);
      }

      if (response.status === 502 || response.status === 503 || response.status === 504) {
        markServerOverloaded(25000);
      }

      // HTTP Error status
      const isRetryable = response.status >= 500 && response.status < 600;
      lastError = new Error(`HTTP ${response.status}: ${data?.message || response.statusText || 'Server error'}`);
      (lastError as any).status = response.status;
      (lastError as any).data = data;

      if (!isRetryable || attempt >= retries) {
        (lastError as any).noRetry = true;
        if (!skipLogging && response.status !== 404 && response.status !== 429) {
          recordLog({
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            method,
            url,
            status: response.status,
            durationMs,
            success: false,
            retries: attempt,
            error: lastError.message,
            responsePreview: responseText
          });
        }
        throw lastError;
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.noRetry) {
        throw err;
      }
      lastError = err;
      const durationMs = Date.now() - startTime;

      // Handle aborted/timeout
      if (err.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${timeoutMs}ms for ${method} ${url}`);
      } else if (err?.message === 'Failed to fetch' || err?.name === 'TypeError') {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          lastError = new Error('Device is currently offline');
          (lastError as any).isOffline = true;
          (lastError as any).noRetry = true;
          throw lastError;
        }
      }

      if (attempt >= retries) {
        if (!skipLogging) {
          recordLog({
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            method,
            url,
            durationMs,
            success: false,
            retries: attempt,
            error: lastError.message || String(err)
          });
        }
        throw lastError;
      }
    }

    attempt++;
    const backoff = retryDelayMs * Math.pow(1.5, attempt - 1) + Math.random() * 200;
    if (!skipLogging) {
      console.warn(`[API Client Retry] ${method} ${url} failed. Retrying in ${Math.round(backoff)}ms (attempt ${attempt}/${retries})...`);
    }
    await new Promise(res => setTimeout(res, backoff));
  }

  throw lastError;
}

async function requestWithRetry<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  if (method === 'GET' && !options.signal) {
    const existing = inFlightGetRequests.get(url);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = executeRequestWithRetry<T>(url, options).finally(() => {
      inFlightGetRequests.delete(url);
    });
    inFlightGetRequests.set(url, promise);
    return promise;
  }
  if (method === 'POST' && !options.signal && normalizeApiRouteKey(url).endsWith('/reconcile')) {
    const reconcileKey = `${method}:${normalizeApiRouteKey(url)}`;
    const existingReconcile = inFlightReconcileRequests.get(reconcileKey);
    if (existingReconcile) {
      return existingReconcile as Promise<T>;
    }
    const reconcilePromise = executeRequestWithRetry<T>(url, options).finally(() => {
      inFlightReconcileRequests.delete(reconcileKey);
    });
    inFlightReconcileRequests.set(reconcileKey, reconcilePromise);
    return reconcilePromise;
  }
  return executeRequestWithRetry<T>(url, options);
}

/**
 * Standard typed API client instance
 */
export const apiClient = {
  // Generic methods
  get: <T = any>(url: string, options?: RequestOptions): Promise<T> =>
    requestWithRetry<T>(url, { ...options, method: 'GET' }),

  post: <T = any>(url: string, body?: any, options?: RequestOptions): Promise<T> =>
    requestWithRetry<T>(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),

  patch: <T = any>(url: string, body?: any, options?: RequestOptions): Promise<T> =>
    requestWithRetry<T>(url, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),

  put: <T = any>(url: string, body?: any, options?: RequestOptions): Promise<T> =>
    requestWithRetry<T>(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),

  delete: <T = any>(url: string, body?: any, options?: RequestOptions): Promise<T> =>
    requestWithRetry<T>(url, {
      ...options,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
    }),

  // ==========================================
  // Domain Specific Endpoints - Tagoloan Water District
  // ==========================================

  // Meter Readers
  getReaders: async () => {
    return apiClient.get<{ success?: boolean; readers?: any[]; staff?: any[] }>('/api/readers');
  },

  updateReader: async (id: string, updates: any) => {
    return apiClient.patch<{ success: boolean; reader?: any }>(`/api/readers/${encodeURIComponent(id)}`, updates);
  },

  deleteReader: async (id: string) => {
    return apiClient.delete<{ success: boolean }>(`/api/readers/${encodeURIComponent(id)}`);
  },

  // Consumers
  getConsumers: async (search?: string) => {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    return apiClient.get<{ success?: boolean; consumers?: any[]; data?: any[] }>(`/api/consumers${query}`);
  },

  updateConsumer: async (accountNumber: string, updates: any) => {
    return apiClient.patch<{ success: boolean; consumer?: any }>(`/api/consumers/${encodeURIComponent(accountNumber)}`, updates);
  },

  saveConsumer: async (consumer: any) => {
    return apiClient.post<{ success: boolean; consumer?: any }>('/api/consumers', consumer);
  },

  deleteConsumer: async (id: string) => {
    return apiClient.delete<{ success: boolean }>(`/api/consumers/${encodeURIComponent(id)}`);
  },

  // Meter Readings & Verification
  getReadings: async () => {
    return apiClient.get<{ success?: boolean; readings?: any[]; data?: any[]; count?: number }>('/api/readings');
  },

  approveReading: async (id: string, approvedBy?: string) => {
    return apiClient.post<{ success: boolean; message?: string }>(
      `/api/readings/${encodeURIComponent(id)}/approve`,
      approvedBy ? { approvedBy } : undefined,
      { retries: 0 }
    );
  },

  approveReadingBatch: async (ids: string[], approvedBy?: string) => {
    if (!ids || ids.length === 0) return { success: true, count: 0 };
    return apiClient.post<{ success: boolean; count?: number; message?: string }>(
      '/api/readings/batch-approve',
      { ids, approvedBy },
      { retries: 0 }
    );
  },

  rejectReading: async (id: string, reason?: string, rejectedBy?: string) => {
    return apiClient.post<{ success: boolean; message?: string }>(
      `/api/readings/${encodeURIComponent(id)}/reject`,
      { reason: reason || 'Requires field re-inspection', rejectedBy }
    );
  },

  submitReading: async (reading: any) => {
    return apiClient.post<{ success: boolean; reading?: any }>('/api/readings', reading);
  },

  syncReadingsBatch: async (readings: any[]) => {
    return apiClient.post<{ success: boolean; processed?: number; readings?: any[] }>('/api/readings/batch', { readings });
  },

  getBillings: async (filters?: { accountNumber?: string }, options?: RequestOptions) => {
    const qs = filters?.accountNumber ? `?accountNumber=${encodeURIComponent(filters.accountNumber)}` : '';
    return apiClient.get<{ success: boolean; readings: any[] }>(`/api/billings${qs}`, {
      retries: 0,
      timeoutMs: 4500,
      skipLogging: true,
      ...options,
    });
  },

  reconcileBillings: async (payload: { readings?: any[]; accountNumber?: string }, options?: RequestOptions) => {
    return apiClient.post<{ success: boolean; readings: any[] }>('/api/billings/reconcile', payload, {
      retries: 0,
      timeoutMs: 4500,
      skipLogging: true,
      ...options,
    });
  },

  // System Health
  checkHealth: async () => {
    return apiClient.get<{ status: string }>('/api/health', { timeoutMs: 4000, retries: 1, skipLogging: true });
  },

  // Consumer Service Reports & Admin Replies
  getReports: async (
    filters?: { accountNumber?: string; email?: string; status?: string; category?: string; search?: string },
    options?: RequestOptions
  ) => {
    const params = new URLSearchParams();
    if (filters?.accountNumber) params.append('accountNumber', filters.accountNumber);
    if (filters?.email) params.append('email', filters.email);
    if (filters?.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters?.category && filters.category !== 'all') params.append('category', filters.category);
    if (filters?.search) params.append('search', filters.search);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get<{ success: boolean; count?: number; reports: any[]; data: any[] }>(
      `/api/reports${queryString}`,
      { retries: 0, timeoutMs: 5000, skipLogging: true, ...options }
    );
  },

  reconcileReports: async (
    payload: { reports?: any[]; accountNumber?: string; email?: string },
    options?: RequestOptions
  ) => {
    return apiClient.post<{ success: boolean; count?: number; reports: any[]; data: any[] }>(
      '/api/reports/reconcile',
      payload,
      { retries: 0, timeoutMs: 5000, skipLogging: true, ...options }
    );
  },

  getReportById: async (id: string, options?: RequestOptions) => {
    return apiClient.get<{ success: boolean; report: any }>(`/api/reports/${encodeURIComponent(id)}`, options);
  },

  createReport: async (reportData: any) => {
    return apiClient.post<{ success: boolean; message: string; report: any }>('/api/reports', reportData);
  },

  replyToReport: async (
    id: string,
    replyData: {
      id?: string;
      replyId?: string;
      senderId: string;
      senderName: string;
      senderRole: 'admin' | 'consumer' | 'staff';
      message: string;
      timestamp?: string;
      statusUpdate?: string;
      assignedStaff?: string;
      report?: any;
    }
  ) => {
    return apiClient.post<{ success: boolean; message: string; report: any; reply: any; notification?: any }>(
      `/api/reports/${encodeURIComponent(id)}/reply`,
      replyData
    );
  },

  updateReportStatus: async (id: string, status: string, assignedStaff?: string, report?: any) => {
    return apiClient.patch<{ success: boolean; message: string; report: any }>(
      `/api/reports/${encodeURIComponent(id)}/status`,
      { status, assignedStaff, report }
    );
  },

  changeConsumerPassword: async (payload: {
    userId?: string;
    email?: string;
    accountNumber?: string;
    currentPassword?: string;
    newPassword: string;
    passwordUpdatedAt?: number;
  }) => {
    return apiClient.post<{ success: boolean; message?: string; user?: any; passwordUpdatedAt?: number }>(
      '/api/consumers/change-password',
      payload
    );
  },

  // District Public Announcements
  getAnnouncements: async (options?: RequestOptions) => {
    return apiClient.get<{ success: boolean; announcements: any[]; data?: any[] }>(
      '/api/announcements',
      { retries: 0, timeoutMs: 5000, skipLogging: true, ...options }
    );
  },

  createAnnouncement: async (announcement: any) => {
    return apiClient.post<{ success: boolean; announcement: any }>('/api/announcements', announcement);
  },

  updateAnnouncement: async (id: string, announcement: any) => {
    return apiClient.put<{ success: boolean; announcement: any }>(
      `/api/announcements/${encodeURIComponent(id)}`,
      announcement
    );
  },

  deleteAnnouncement: async (id: string) => {
    return apiClient.delete<{ success: boolean }>(`/api/announcements/${encodeURIComponent(id)}`);
  },

  // Water Tariff Schedule Sync
  getTariffConfig: async (options?: RequestOptions) => {
    return apiClient.get<{ success: boolean; config: any }>(
      '/api/tariff-config',
      { retries: 0, timeoutMs: 5000, skipLogging: true, ...options }
    );
  },

  saveTariffConfig: async (config: any) => {
    return apiClient.post<{ success: boolean; config: any }>('/api/tariff-config', config);
  },

  // Water Meter Installation Scheduling & Validation
  getInstallations: async (filters?: { email?: string; userId?: string; applicationNumber?: string }, options?: RequestOptions) => {
    const params = new URLSearchParams();
    if (filters?.email) params.append('email', filters.email);
    if (filters?.userId) params.append('userId', filters.userId);
    if (filters?.applicationNumber) params.append('applicationNumber', filters.applicationNumber);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get<{ success: boolean; installations: any[] }>(`/api/installations${qs}`, {
      retries: 0,
      timeoutMs: 5000,
      skipLogging: true,
      ...options,
    });
  },

  createInstallation: async (payload: any) => {
    return apiClient.post<{ success: boolean; request: any }>('/api/installations', payload);
  },

  updateInstallation: async (id: string, payload: any) => {
    return apiClient.patch<{ success: boolean; request: any }>(`/api/installations/${encodeURIComponent(id)}`, payload);
  },

  validateInstallation: async (id: string, payload: any) => {
    return apiClient.post<{ success: boolean; request: any; consumer?: any }>(
      `/api/installations/${encodeURIComponent(id)}/validate`,
      payload
    );
  },

  // Physical Water Meters & Mobile Terminal Bridge
  syncMeterStatus: async (
    meterNumber: string,
    payload: { status: string; remarks?: string; updatedBy?: string; linkedAccountNumber?: string }
  ) => {
    return apiClient.post<{ success: boolean; meter?: any }>(
      `/api/meters/${encodeURIComponent(meterNumber)}/status`,
      payload,
      { retries: 0, timeoutMs: 8000, skipLogging: true }
    );
  },

  reconcileMeters: async (meters: any[], options?: RequestOptions) => {
    return apiClient.post<{ success: boolean; count?: number; meters?: any[] }>(
      '/api/meters/reconcile',
      { meters },
      { retries: 0, timeoutMs: 6000, skipLogging: true, ...options }
    );
  },

  reconcileConsumers: async (consumers: any[], options?: RequestOptions) => {
    return apiClient.post<{ success: boolean; consumersCount?: number; consumers?: any[] }>(
      '/api/consumers/reconcile',
      { consumers },
      { retries: 0, timeoutMs: 6000, skipLogging: true, ...options }
    );
  },

  getMobileBridgeStatus: async (options?: RequestOptions) => {
    return apiClient.get<{ success: boolean; bridge: any }>('/api/mobile-bridge/status', {
      retries: 0,
      timeoutMs: 6000,
      skipLogging: true,
      ...options,
    });
  },

  syncMobileBridgeNow: async () => {
    return apiClient.post<{
      success: boolean;
      message?: string;
      bridge: any;
    }>(
      '/api/mobile-bridge/sync',
      {},
      { retries: 0, timeoutMs: 35000 }
    );
  },
};
