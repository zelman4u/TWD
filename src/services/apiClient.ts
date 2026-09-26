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
    console.info(
      `%c${prefix} %c${entry.status || 200} (${entry.durationMs}ms)${entry.retries > 0 ? ` [retries: ${entry.retries}]` : ''}`,
      'color: #059669; font-weight: bold;',
      'color: #64748b;'
    );
  } else {
    console.warn(
      `%c${prefix} %c${entry.status || 'ERR'} (${entry.durationMs}ms) - ${entry.error || 'Request failed'}`,
      'color: #dc2626; font-weight: bold;',
      'color: #b91c1c;'
    );
  }
}

/**
 * Executes an HTTP fetch request with timeout, retries, and exponential backoff
 */
async function requestWithRetry<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
  const {
    retries = 2,
    retryDelayMs = 800,
    timeoutMs = 12000,
    skipLogging = false,
    ...fetchOptions
  } = options;

  const method = fetchOptions.method || 'GET';
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

      // HTTP Error status
      const isRetryable = response.status >= 500 && response.status < 600;
      lastError = new Error(`HTTP ${response.status}: ${data?.message || response.statusText || 'Server error'}`);
      (lastError as any).status = response.status;
      (lastError as any).data = data;

      if (!isRetryable || attempt >= retries) {
        if (!skipLogging) {
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
      lastError = err;
      const durationMs = Date.now() - startTime;

      // Handle aborted/timeout
      if (err.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${timeoutMs}ms for ${method} ${url}`);
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
    console.warn(`[API Client Retry] ${method} ${url} failed. Retrying in ${Math.round(backoff)}ms (attempt ${attempt}/${retries})...`);
    await new Promise(res => setTimeout(res, backoff));
  }

  throw lastError;
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

  approveReading: async (id: string) => {
    return apiClient.post<{ success: boolean; message?: string }>(`/api/readings/${encodeURIComponent(id)}/approve`);
  },

  submitReading: async (reading: any) => {
    return apiClient.post<{ success: boolean; reading?: any }>('/api/readings', reading);
  },

  syncReadingsBatch: async (readings: any[]) => {
    return apiClient.post<{ success: boolean; processed?: number; readings?: any[] }>('/api/readings/batch', { readings });
  },

  // System Health
  checkHealth: async () => {
    return apiClient.get<{ status: string }>('/api/health', { timeoutMs: 4000, retries: 1, skipLogging: true });
  }
};
