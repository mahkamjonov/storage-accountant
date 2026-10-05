// Biznes qoidalari: qoldiq manfiy bo'lmasligi, bekor qilish shartlari, sanab tuzatish farqi.
import { applyEffect, movementEffect, type Effect } from './stock.ts';
import type { Direction, Location, Movement, MovementType, Stock } from './types.ts';

export const MAX_QUANTITY = 1_000_000;

export interface MovementDraft {
  type: MovementType;
  quantity: number;
  location?: Location | null;
  direction?: Direction | null;
}

export type RuleError =
  | { code: 'INVALID_QUANTITY' }
  | { code: 'INVALID_COUNT' }
  | { code: 'LOCATION_REQUIRED' }
  | { code: 'NOT_ENOUGH'; location: Location; available: number; requested: number }
  | { code: 'NO_CHANGE'; location: Location; counted: number }
  | { code: 'ALREADY_VOIDED' }
  | { code: 'VOID_GOES_NEGATIVE'; location: Location; available: number; needed: number };

export type Result<T> = ({ ok: true } & T) | { ok: false; error: RuleError };

export function needsLocation(type: MovementType): boolean {
  return type === 'written_off' || type === 'adjustment';
}

/** Sotuv va qaytarishda joy ixtiyoriy: 'own' — FBS (omborimdan), aks holda FBO (Uzum omboridan). */
export function allowsLocation(type: MovementType): boolean {
  return needsLocation(type) || type === 'sold' || type === 'returned';
}

export function isValidQuantity(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= MAX_QUANTITY;
}

export function isValidCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_QUANTITY;
}

/** Turga kerak bo'lmagan maydonlarni tozalaydi. */
export function normalizeDraft(draft: MovementDraft): Required<MovementDraft> {
  return {
    type: draft.type,
    quantity: draft.quantity,
    location: needsLocation(draft.type)
      ? (draft.location ?? null)
      : allowsLocation(draft.type) && draft.location === 'own'
        ? 'own'
        : null,
    direction: draft.type === 'adjustment' ? (draft.direction ?? null) : null,
  };
}

/** Ta'sirdan keyin manfiy bo'lib qolgan birinchi joy. */
function firstShortage(before: Stock, effect: Effect): Location | null {
  if (before.own + effect.own < 0) return 'own';
  if (before.uzum + effect.uzum < 0) return 'uzum';
  return null;
}

/**
 * Yangi harakat natijasini oldindan hisoblaydi va tekshiradi.
 * Ham interfeysda (oldindan ko'rsatish), ham serverda (saqlashdan oldin) ishlatiladi.
 */
export function previewMovement(
  before: Stock,
  draft: MovementDraft,
): Result<{ before: Stock; after: Stock; effect: Effect }> {
  const d = normalizeDraft(draft);
  if (!isValidQuantity(d.quantity)) return { ok: false, error: { code: 'INVALID_QUANTITY' } };
  if (needsLocation(d.type) && d.location === null) return { ok: false, error: { code: 'LOCATION_REQUIRED' } };
  if (d.type === 'adjustment' && d.direction === null) return { ok: false, error: { code: 'INVALID_QUANTITY' } };

  const effect = movementEffect(d);
  const shortage = firstShortage(before, effect);
  if (shortage) {
    return {
      ok: false,
      error: { code: 'NOT_ENOUGH', location: shortage, available: before[shortage], requested: -effect[shortage] },
    };
  }
  return { ok: true, before, after: applyEffect(before, effect), effect };
}

/**
 * Sanab tuzatish: sotuvchi haqiqiy sonni kiritadi, tizim farqni hisoblaydi.
 * Farq yo'q bo'lsa — yozuv kerak emas.
 */
export function adjustmentFromCount(
  stock: Stock,
  location: Location,
  counted: number,
): Result<{ quantity: number; direction: Direction }> {
  if (!isValidCount(counted)) return { ok: false, error: { code: 'INVALID_COUNT' } };
  const diff = counted - stock[location];
  if (diff === 0) return { ok: false, error: { code: 'NO_CHANGE', location, counted } };
  return { ok: true, quantity: Math.abs(diff), direction: diff > 0 ? 'increase' : 'decrease' };
}

/**
 * Yozuvni bekor qilish mumkinmi? `current` — shu yozuv hisobga olingan hozirgi qoldiq.
 * Bekor qilish qoldiqni manfiy qilsa, ruxsat berilmaydi.
 */
export function checkVoid(current: Stock, movement: Movement): Result<{ after: Stock }> {
  if (movement.voidedAt !== null) return { ok: false, error: { code: 'ALREADY_VOIDED' } };
  const effect = movementEffect(movement);
  const after = applyEffect(current, effect, -1);
  if (after.own < 0) {
    return { ok: false, error: { code: 'VOID_GOES_NEGATIVE', location: 'own', available: current.own, needed: effect.own } };
  }
  if (after.uzum < 0) {
    return { ok: false, error: { code: 'VOID_GOES_NEGATIVE', location: 'uzum', available: current.uzum, needed: effect.uzum } };
  }
  return { ok: true, after };
}
