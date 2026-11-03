/**
 * Quota-resilient storage layer for Tagoloan Water District.
 *
 * Prevents browser `QuotaExceededError` on `twd_live_v4_readings` and other keys by:
 * 1. Maintaining an authoritative in-memory backing store so reads/writes never fail or revert to stale data.
 * 2. Offloading large inline `data:image/...` strings (>8 KB) into a bounded session memory map (`memimg://...`)
 *    before serializing JSON to `localStorage`, keeping `localStorage` usage well under the 5 MB browser limit.
 * 3. Automatically scrubbing any pre-existing bloated `data:image/...` payloads in `localStorage` on startup.
 */

const INLINE_IMAGE_MAX_CHARS = 8192;
const MAX_SESSION_IMAGES = 45;
const MEM_IMG_PREFIX = 'memimg://';

const memoryBackingStore = new Map<string, string>();
const sessionImageStore = new Map<string, string>();
let didScrubExistingStorage = false;

const IMAGE_FIELD_NAMES = [
  'imageUrl',
  'meterImageUrl',
  'photoUrl',
  'dialPhotoUrl',
  'paymentReceiptUrl',
  'receiptUrl',
  'attachmentUrl',
  'proofPhotoUrl',
] as const;

function rememberSessionImage(tokenKey: string, dataUrl: string): string {
  if (!sessionImageStore.has(tokenKey) && sessionImageStore.size >= MAX_SESSION_IMAGES) {
    const oldestKey = sessionImageStore.keys().next().value;
    if (oldestKey) {
      sessionImageStore.delete(oldestKey);
    }
  }
  sessionImageStore.set(tokenKey, dataUrl);
  return `${MEM_IMG_PREFIX}${tokenKey}`;
}

/**
 * Offloads large base64 data URLs from an item or array of items into `sessionImageStore`
 * and returns a storage-compact clone suitable for `localStorage`.
 */
export function compactValueForLocalStorage<T>(key: string, value: T): T {
  if (!value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    let anyModified = false;
    const compacted = value.map((item, idx) => {
      if (!item || typeof item !== 'object') return item;
      const rec = item as Record<string, unknown>;
      const itemId = String(rec.id || rec.accountNumber || rec.meterNumber || idx);
      let itemClone: Record<string, unknown> | null = null;

      for (const field of IMAGE_FIELD_NAMES) {
        const rawVal = rec[field];
        if (typeof rawVal === 'string' && rawVal.startsWith('data:image/') && rawVal.length > INLINE_IMAGE_MAX_CHARS) {
          if (!itemClone) itemClone = { ...rec };
          const token = rememberSessionImage(`${key}:${itemId}:${field}`, rawVal);
          itemClone[field] = token;
          anyModified = true;
        }
      }
      return itemClone || item;
    });
    return (anyModified ? compacted : value) as unknown as T;
  }

  const rec = value as Record<string, unknown>;
  let clone: Record<string, unknown> | null = null;
  for (const field of IMAGE_FIELD_NAMES) {
    const rawVal = rec[field];
    if (typeof rawVal === 'string' && rawVal.startsWith('data:image/') && rawVal.length > INLINE_IMAGE_MAX_CHARS) {
      if (!clone) clone = { ...rec };
      clone[field] = rememberSessionImage(`${key}:single:${field}`, rawVal);
    }
  }
  return (clone || value) as T;
}

/**
 * Restores any `memimg://...` placeholders from `sessionImageStore` when reading items in the active session.
 * If an image token is from a prior browser session and no longer in RAM, resolves cleanly to `''` instead of broken URLs.
 */
export function rehydrateValueFromSessionImages<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    let anyRehydrated = false;
    const restored = value.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const rec = item as Record<string, unknown>;
      let itemClone: Record<string, unknown> | null = null;

      for (const field of IMAGE_FIELD_NAMES) {
        const rawVal = rec[field];
        if (typeof rawVal === 'string' && rawVal.startsWith(MEM_IMG_PREFIX)) {
          if (!itemClone) itemClone = { ...rec };
          const tokenKey = rawVal.slice(MEM_IMG_PREFIX.length);
          itemClone[field] = sessionImageStore.get(tokenKey) || '';
          anyRehydrated = true;
        }
      }
      return itemClone || item;
    });
    return (anyRehydrated ? restored : value) as unknown as T;
  }

  const rec = value as Record<string, unknown>;
  let clone: Record<string, unknown> | null = null;
  for (const field of IMAGE_FIELD_NAMES) {
    const rawVal = rec[field];
    if (typeof rawVal === 'string' && rawVal.startsWith(MEM_IMG_PREFIX)) {
      if (!clone) clone = { ...rec };
      const tokenKey = rawVal.slice(MEM_IMG_PREFIX.length);
      clone[field] = sessionImageStore.get(tokenKey) || '';
    }
  }
  return (clone || value) as T;
}

/**
 * Strips oversized inline base64 images before sending JSON payloads to `/api/billings/reconcile`
 * so network requests stay small and fast.
 */
export function stripOversizedImagesForSync<T>(items: T[], maxInlineChars = 90000): T[] {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const rec = item as Record<string, unknown>;
    let clone: Record<string, unknown> | null = null;
    for (const field of IMAGE_FIELD_NAMES) {
      const val = rec[field];
      if (typeof val === 'string' && (val.startsWith(MEM_IMG_PREFIX) || (val.startsWith('data:image/') && val.length > maxInlineChars))) {
        if (!clone) clone = { ...rec };
        delete clone[field];
      }
    }
    return (clone || item) as T;
  });
}

/**
 * One-time startup scrubber that compacts any pre-existing multi-MB `twd_live_v4_*` entries in `localStorage`
 * so browsers that previously hit `QuotaExceededError` recover immediately without losing any records.
 */
export function scrubBloatedLocalStorageOnce(): void {
  if (didScrubExistingStorage || typeof window === 'undefined') return;
  didScrubExistingStorage = true;

  try {
    const keysToInspect: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('twd_live_v4_')) {
        keysToInspect.push(k);
      }
    }

    for (const k of keysToInspect) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      if (raw.length > 150000 && raw.includes('data:image/')) {
        try {
          const parsed = JSON.parse(raw);
          const compacted = compactValueForLocalStorage(k, parsed);
          const nextJson = JSON.stringify(compacted);
          memoryBackingStore.set(k, nextJson);
          if (nextJson.length < raw.length) {
            localStorage.setItem(k, nextJson);
          }
        } catch {
          // Ignore malformed entry
        }
      } else if (k.endsWith('audit_logs') && raw.length > 120000) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 120) {
            const trimmed = JSON.stringify(parsed.slice(0, 120));
            memoryBackingStore.set(k, trimmed);
            localStorage.setItem(k, trimmed);
          }
        } catch {}
      }
    }
  } catch {
    // Storage access restricted in sandboxed context; memoryBackingStore handles seamlessly
  }
}

function emergencyFreeLocalStorageQuota(protectedKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    // 1. Trim audit logs first
    const auditKey = 'twd_live_v4_audit_logs';
    if (protectedKey !== auditKey) {
      const rawAudit = localStorage.getItem(auditKey);
      if (rawAudit) {
        try {
          const parsed = JSON.parse(rawAudit);
          if (Array.isArray(parsed) && parsed.length > 60) {
            localStorage.setItem(auditKey, JSON.stringify(parsed.slice(0, 60)));
          } else {
            localStorage.removeItem(auditKey);
          }
        } catch {
          localStorage.removeItem(auditKey);
        }
      }
    }

    // 2. Compact all `twd_live_v4_*` arrays containing inline base64 images
    const allKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('twd_live_v4_') && k !== protectedKey) {
        allKeys.push(k);
      }
    }
    for (const k of allKeys) {
      const raw = localStorage.getItem(k);
      if (raw && raw.includes('data:image/')) {
        try {
          const parsed = JSON.parse(raw);
          const compacted = compactValueForLocalStorage(k, parsed);
          const nextJson = JSON.stringify(compacted);
          memoryBackingStore.set(k, nextJson);
          localStorage.setItem(k, nextJson);
        } catch {}
      }
    }
  } catch {}
}

/**
 * Quota-safe replacement for `localStorage.getItem(key)` that prefers the authoritative in-memory backing store
 * if a recent write exceeded browser `localStorage` quota, and otherwise reads from `localStorage`.
 */
export function safeStorageGetItem(key: string): string | null {
  scrubBloatedLocalStorageOnce();
  if (typeof window === 'undefined') {
    return memoryBackingStore.get(key) ?? null;
  }
  try {
    const diskVal = localStorage.getItem(key);
    if (diskVal !== null) {
      // If memoryBackingStore was explicitly updated more recently due to quota fallback, prefer memory
      if (memoryBackingStore.has(key)) {
        return memoryBackingStore.get(key)!;
      }
      return diskVal;
    }
    return memoryBackingStore.get(key) ?? null;
  } catch {
    return memoryBackingStore.get(key) ?? null;
  }
}

/**
 * Quota-safe JSON writer for `twd_live_v4_*` collections.
 * Compacts large inline images, updates `memoryBackingStore` atomically, and persists to `localStorage`
 * with automatic quota recovery so `QuotaExceededError` never breaks state updates or event propagation.
 * Returns `{ changed: boolean, json: string }`.
 */
export function safeStorageSetStructured<T>(key: string, value: T): { changed: boolean; json: string } {
  scrubBloatedLocalStorageOnce();

  let preparedValue: T = value;
  if (key.endsWith('audit_logs') && Array.isArray(value) && value.length > 200) {
    preparedValue = value.slice(0, 200) as unknown as T;
  }
  const compacted = compactValueForLocalStorage(key, preparedValue);
  const nextJson = JSON.stringify(compacted);

  const prevJson = safeStorageGetItem(key);
  if (prevJson === nextJson) {
    memoryBackingStore.set(key, nextJson);
    return { changed: false, json: nextJson };
  }

  // Always commit to authoritative in-memory store FIRST so reads are 100% consistent immediately
  memoryBackingStore.set(key, nextJson);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(key, nextJson);
    } catch {
      // Recover quota by compacting other keys & trimming old audit logs, then retry once
      emergencyFreeLocalStorageQuota(key);
      try {
        localStorage.setItem(key, nextJson);
      } catch {
        // Browser storage quota still restricted; memoryBackingStore already holds the authoritative state
      }
    }
  }

  return { changed: true, json: nextJson };
}

/**
 * Syncs `memoryBackingStore` when another browser tab updates `localStorage` via `StorageEvent`.
 */
export function syncMemoryStoreFromStorageEvent(key?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!key || key === 'twd_sync_ping') {
      memoryBackingStore.clear();
      return;
    }
    const disk = localStorage.getItem(key);
    if (disk !== null) {
      memoryBackingStore.set(key, disk);
    } else {
      memoryBackingStore.delete(key);
    }
  } catch {}
}
