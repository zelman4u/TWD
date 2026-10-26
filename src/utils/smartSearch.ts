/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SearchableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SearchableValue[];

/**
 * Normalizes text for case-insensitive, accent-insensitive smart matching.
 */
export function normalizeSearchText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Produces compact identifier/phone tokens so queries like:
 * - "09171234567" match "+63 917-123-4567" or "0917 123 4567"
 * - "2026001" or "nt2026001" match "#NT-2026-001"
 * - "1250" matches "₱1,250.00"
 */
export function normalizeCompactId(input: unknown): string {
  if (input === null || input === undefined) return '';
  let raw = String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  // Normalize Philippine mobile prefix +639... or 639... (12 digits) -> 09...
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly.length === 12 && digitsOnly.startsWith('639')) {
    return '0' + digitsOnly.slice(2);
  }

  raw = raw.replace(/^\+63\s*9/, '09');
  return raw.replace(/[#\-_/.(),₱$\s:]/g, '');
}

/**
 *Bounded Levenshtein distance <= 1 check for typo tolerance on longer words (length >= 5).
 */
function isWithinOneEdit(a: string, b: string): boolean {
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      edits++;
      if (edits > 1) return false;
      if (a.length > b.length) {
        i++;
      } else if (b.length > a.length) {
        j++;
      } else {
        i++;
        j++;
      }
    }
  }

  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

function flattenFields(fields: SearchableValue[], out: string[] = []): string[] {
  for (const item of fields) {
    if (item === null || item === undefined || item === false) continue;
    if (Array.isArray(item)) {
      flattenFields(item, out);
    } else {
      const str = String(item).trim();
      if (str) out.push(str);
    }
  }
  return out;
}

/**
 * Multi-token Smart Search matcher:
 * - Splits query into tokens; EVERY token must match at least one field (AND across tokens, OR across fields).
 * - Supports normalized text, compact account/meter/ticket/OR numbers, PH phone formats (+63 / 09),
 *   and 1-character typo tolerance for 5+ character words.
 */
export function smartMatch(query: string, fields: SearchableValue[]): boolean {
  if (!query) return true;
  const trimmed = query.trim();
  if (!trimmed) return true;

  const rawValues = flattenFields(fields);
  if (rawValues.length === 0) return false;

  const normalizedFields = rawValues.map(normalizeSearchText).filter(Boolean);
  const compactFields = rawValues.map(normalizeCompactId).filter(Boolean);
  const fullNormalizedText = normalizedFields.join(' ');
  const words = fullNormalizedText.split(/[\s,.;:()/\-]+/).filter((w) => w.length >= 4);

  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return tokens.every((rawToken) => {
    const normToken = normalizeSearchText(rawToken).replace(/^#/, '');
    if (!normToken) return true;

    // 1. Direct normalized substring match
    if (fullNormalizedText.includes(normToken)) {
      return true;
    }

    // 2. Compact ID / phone / currency match
    const compactToken = normalizeCompactId(rawToken);
    if (compactToken.length >= 2) {
      if (compactFields.some((cf) => cf.includes(compactToken))) {
        return true;
      }
    }

    // 3. Minor 1-character typo tolerance on alphabetic words >= 5 chars
    if (normToken.length >= 5 && /^[a-z]+$/.test(normToken)) {
      if (words.some((w) => isWithinOneEdit(normToken, w) || (w.length > normToken.length && isWithinOneEdit(normToken, w.slice(0, normToken.length))))) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Filters a list of items using smartMatch.
 */
export function smartFilter<T>(
  items: T[],
  query: string,
  getFields: (item: T) => SearchableValue[]
): T[] {
  if (!query || !query.trim()) return items;
  return items.filter((item) => smartMatch(query, getFields(item)));
}
