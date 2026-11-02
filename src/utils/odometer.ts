/**
 * Official Five-Digit Mechanical Odometer Reading Utilities (00000 to 99999)
 * Tagoloan Water District — Physical Water Meter Dial Standard
 *
 * Mechanical water meters use a 5-digit odometer register from 00000 to 99999
 * (modulo 100000). When a dial passes 99999, it wraps cleanly back to 00000.
 */

export const ODOMETER_DIGITS = 5;
export const ODOMETER_MIN = 0;
export const ODOMETER_MAX = 99999;
export const ODOMETER_MODULO = 100000;

/**
 * Normalizes any raw meter dial index into a valid integer within [0, 99999].
 * Values >= 100000 wrap modulo 100000; negative/NaN/empty values normalize to 0.
 */
export function normalizeOdometerReading(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  const intVal = Math.floor(parsed);
  return ((intVal % ODOMETER_MODULO) + ODOMETER_MODULO) % ODOMETER_MODULO;
}

/**
 * Formats any meter reading index as a zero-padded 5-digit odometer string ("00000" to "99999").
 */
export function formatOdometerReading(value: unknown): string {
  return String(normalizeOdometerReading(value)).padStart(ODOMETER_DIGITS, '0');
}

/**
 * Sanitizes live user typing in a 5-digit odometer input field (digits 0–9 only, max 5 chars).
 */
export function sanitizeOdometerInput(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '').slice(0, ODOMETER_DIGITS);
}

/**
 * Pads a sanitized odometer input string to 5 digits ("00000"–"99999"), e.g. on blur.
 */
export function padOdometerInput(raw: string): string {
  const clean = sanitizeOdometerInput(raw);
  return clean ? clean.padStart(ODOMETER_DIGITS, '0') : '00000';
}

/**
 * Validates that a user-provided string represents a valid 1-to-5-digit odometer reading (00000–99999).
 */
export function isValidOdometerInput(raw: string): boolean {
  const trimmed = String(raw ?? '').trim();
  if (!/^\d{1,5}$/.test(trimmed)) return false;
  const num = Number(trimmed);
  return Number.isInteger(num) && num >= ODOMETER_MIN && num <= ODOMETER_MAX;
}

export interface OdometerConsumptionResult {
  previousReading: number;
  currentReading: number;
  consumption: number;
  rolledOver: boolean;
}

/**
 * Computes volumetric water consumption (m³) between two 5-digit odometer dial indices,
 * supporting physical 5-digit dial wrap-around (99999 -> 00000).
 *
 * Example:
 * - Normal:   previous = 04377, current = 04393 => consumption = 16 m³, rolledOver = false
 * - Rollover: previous = 99990, current = 00005 => consumption = (100000 - 99990) + 5 = 15 m³, rolledOver = true
 */
export function computeOdometerConsumption(
  previous: unknown,
  current: unknown,
  explicitConsumption?: unknown
): OdometerConsumptionResult {
  const prev = normalizeOdometerReading(previous);
  const curr = normalizeOdometerReading(current);
  const rolledOver = curr < prev;
  const computed = rolledOver ? ODOMETER_MODULO - prev + curr : curr - prev;

  if (explicitConsumption !== undefined && explicitConsumption !== null && explicitConsumption !== '') {
    const expNum = Number(explicitConsumption);
    if (Number.isFinite(expNum) && expNum >= 0) {
      const roundedExp = Math.round(expNum);
      if ((prev + roundedExp) % ODOMETER_MODULO === curr) {
        return {
          previousReading: prev,
          currentReading: curr,
          consumption: roundedExp,
          rolledOver,
        };
      }
    }
  }

  return {
    previousReading: prev,
    currentReading: curr,
    consumption: computed,
    rolledOver,
  };
}

/**
 * Detects whether a `current < previous` pair represents an accidental backward typo
 * (e.g. 04377 -> 00439 = 96,062 m³) rather than a genuine mechanical rollover near 99999 -> 00000.
 */
export function isImplausibleRollover(
  previous: unknown,
  current: unknown,
  maxPlausibleRolloverM3 = 5000
): boolean {
  const prev = normalizeOdometerReading(previous);
  const curr = normalizeOdometerReading(current);
  if (curr >= prev) return false;
  const wrappedConsumption = ODOMETER_MODULO - prev + curr;
  return wrappedConsumption > maxPlausibleRolloverM3;
}
