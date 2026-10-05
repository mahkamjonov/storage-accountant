import { describe, expect, it } from 'vitest';
import {
  adjustmentFromCount,
  buildVariantMatrix,
  normalizeCode,
  suggestCode,
  variantLabel,
  checkVoid,
  computeStock,
  computeStockByVariant,
  EMPTY_STOCK,
  formatRuleError,
  isLowStock,
  makeStock,
  movementEffect,
  previewMovement,
  type Movement,
  type MovementDraft,
  type Stock,
} from './index.ts';

let seq = 0;
function mv(draft: MovementDraft & { variantId?: string; voidedAt?: string | null }): Movement {
  seq += 1;
  return {
    id: `m${seq}`,
    variantId: draft.variantId ?? 'p1',
    type: draft.type,
    quantity: draft.quantity,
    location: draft.location ?? null,
    direction: draft.direction ?? null,
    countedQuantity: null,
    note: null,
    date: '2026-10-01',
    createdAt: new Date(2026, 9, 1, 0, 0, seq).toISOString(),
    voidedAt: draft.voidedAt ?? null,
    source: 'manual',
    sourceLabel: null,
  };
}

/** Harakatlarni ketma-ket tekshirib qo'shadi — xuddi ilovadagidek. */
function record(movements: Movement[], draft: MovementDraft): Stock {
  const result = previewMovement(computeStock(movements), draft);
  if (!result.ok) throw new Error(formatRuleError(result.error));
  movements.push(mv(draft));
  return result.after;
}

describe('movementEffect', () => {
  it('har bir tur jadvaldagi kabi ta\'sir qiladi', () => {
    expect(movementEffect({ type: 'received', quantity: 5, location: null, direction: null })).toEqual({ own: 5, uzum: 0 });
    expect(movementEffect({ type: 'to_uzum', quantity: 5, location: null, direction: null })).toEqual({ own: -5, uzum: 5 });
    expect(movementEffect({ type: 'sold', quantity: 5, location: null, direction: null })).toEqual({ own: 0, uzum: -5 });
    expect(movementEffect({ type: 'returned', quantity: 5, location: null, direction: null })).toEqual({ own: 5, uzum: -5 });
    expect(movementEffect({ type: 'written_off', quantity: 5, location: 'own', direction: null })).toEqual({ own: -5, uzum: 0 });
    expect(movementEffect({ type: 'written_off', quantity: 5, location: 'uzum', direction: null })).toEqual({ own: 0, uzum: -5 });
    expect(movementEffect({ type: 'adjustment', quantity: 3, location: 'own', direction: 'increase' })).toEqual({ own: 3, uzum: 0 });
    expect(movementEffect({ type: 'adjustment', quantity: 3, location: 'uzum', direction: 'decrease' })).toEqual({ own: 0, uzum: -3 });
  });
});

describe('qabul mezoni: keldi 100 → jo\'natdim 30 → sotildi 5 → qaytdi 2', () => {
  it('Omborda 72, Uzumda 23, Jami 95', () => {
    const movements: Movement[] = [];
    record(movements, { type: 'received', quantity: 100 });
    record(movements, { type: 'to_uzum', quantity: 30 });
    record(movements, { type: 'sold', quantity: 5 });
    const last = record(movements, { type: 'returned', quantity: 2 });

    expect(last).toEqual({ own: 72, uzum: 23, total: 95 });
    expect(computeStock(movements)).toEqual({ own: 72, uzum: 23, total: 95 });
  });

  it('oraliq natijalar ham to\'g\'ri', () => {
    const movements: Movement[] = [];
    expect(record(movements, { type: 'received', quantity: 100 })).toEqual(makeStock(100, 0));
    expect(record(movements, { type: 'to_uzum', quantity: 30 })).toEqual(makeStock(70, 30));
    expect(record(movements, { type: 'sold', quantity: 5 })).toEqual(makeStock(70, 25));
    expect(record(movements, { type: 'returned', quantity: 2 })).toEqual(makeStock(72, 23));
  });
});

describe('computeStock', () => {
  it('bo\'sh ro\'yxat — nol', () => {
    expect(computeStock([])).toEqual(EMPTY_STOCK);
  });

  it('bekor qilingan yozuvlar hisobga olinmaydi', () => {
    const movements = [
      mv({ type: 'received', quantity: 100 }),
      mv({ type: 'to_uzum', quantity: 30, voidedAt: '2026-10-01T10:00:00.000Z' }),
      mv({ type: 'received', quantity: 5 }),
    ];
    expect(computeStock(movements)).toEqual(makeStock(105, 0));
  });

  it('mahsulotlar bo\'yicha alohida hisoblaydi', () => {
    const map = computeStockByVariant([
      mv({ variantId: 'a', type: 'received', quantity: 10 }),
      mv({ variantId: 'b', type: 'received', quantity: 7 }),
      mv({ variantId: 'a', type: 'to_uzum', quantity: 4 }),
    ]);
    expect(map.get('a')).toEqual(makeStock(6, 4));
    expect(map.get('b')).toEqual(makeStock(7, 0));
  });
});

describe('previewMovement — qoldiq manfiy bo\'lmaydi', () => {
  const stock = makeStock(40, 10);

  it('omborimdagidan ko\'p jo\'natib bo\'lmaydi', () => {
    const r = previewMovement(stock, { type: 'to_uzum', quantity: 41 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toEqual({ code: 'NOT_ENOUGH', location: 'own', available: 40, requested: 41 });
      expect(formatRuleError(r.error)).toContain('Omboringizda faqat 40 ta bor');
    }
  });

  it('aynan mavjud sonni jo\'natish mumkin', () => {
    const r = previewMovement(stock, { type: 'to_uzum', quantity: 40 });
    expect(r.ok && r.after).toEqual(makeStock(0, 50));
  });

  it('Uzumdagidan ko\'p sotib bo\'lmaydi', () => {
    const r = previewMovement(stock, { type: 'sold', quantity: 11 });
    expect(!r.ok && r.error).toMatchObject({ code: 'NOT_ENOUGH', location: 'uzum', available: 10 });
  });

  it('Uzumdagidan ko\'p qaytib bo\'lmaydi', () => {
    const r = previewMovement(stock, { type: 'returned', quantity: 11 });
    expect(!r.ok && r.error).toMatchObject({ code: 'NOT_ENOUGH', location: 'uzum' });
  });

  it('brak tanlangan joydan ayriladi va o\'sha joy tekshiriladi', () => {
    expect(previewMovement(stock, { type: 'written_off', quantity: 15, location: 'own' }).ok).toBe(true);
    const r = previewMovement(stock, { type: 'written_off', quantity: 15, location: 'uzum' });
    expect(!r.ok && r.error).toMatchObject({ code: 'NOT_ENOUGH', location: 'uzum', available: 10 });
  });

  it('brak uchun joy majburiy', () => {
    const r = previewMovement(stock, { type: 'written_off', quantity: 1 });
    expect(!r.ok && r.error.code).toBe('LOCATION_REQUIRED');
  });

  it.each([0, -3, 2.5, Number.NaN])('noto\'g\'ri son: %s', (q) => {
    const r = previewMovement(stock, { type: 'received', quantity: q });
    expect(!r.ok && r.error.code).toBe('INVALID_QUANTITY');
  });

  it('bo\'sh omborda xabar boshqacha', () => {
    const r = previewMovement(EMPTY_STOCK, { type: 'to_uzum', quantity: 1 });
    expect(!r.ok && formatRuleError(r.error)).toContain("hozir bu mahsulot yo'q");
  });
});

describe('adjustmentFromCount — sanab tuzatish', () => {
  const stock = makeStock(50, 20);

  it('kam sanalsa — kamaytiradi', () => {
    expect(adjustmentFromCount(stock, 'own', 45)).toEqual({ ok: true, quantity: 5, direction: 'decrease' });
  });

  it('ko\'p sanalsa — oshiradi', () => {
    expect(adjustmentFromCount(stock, 'uzum', 26)).toEqual({ ok: true, quantity: 6, direction: 'increase' });
  });

  it('nolga tuzatish mumkin', () => {
    const adj = adjustmentFromCount(stock, 'own', 0);
    expect(adj).toEqual({ ok: true, quantity: 50, direction: 'decrease' });
    if (adj.ok) {
      const r = previewMovement(stock, { type: 'adjustment', location: 'own', quantity: adj.quantity, direction: adj.direction });
      expect(r.ok && r.after).toEqual(makeStock(0, 20));
    }
  });

  it('farq yo\'q bo\'lsa — yozuv kerak emas', () => {
    const r = adjustmentFromCount(stock, 'own', 50);
    expect(!r.ok && r.error.code).toBe('NO_CHANGE');
  });

  it('manfiy son kiritib bo\'lmaydi', () => {
    const r = adjustmentFromCount(stock, 'own', -1);
    expect(!r.ok && r.error.code).toBe('INVALID_COUNT');
  });
});

describe('checkVoid — bekor qilish', () => {
  it('bekor qilingandan keyin qoldiq qayta hisoblanadi, yozuv saqlanadi', () => {
    const movements: Movement[] = [];
    record(movements, { type: 'received', quantity: 100 });
    record(movements, { type: 'to_uzum', quantity: 30 });
    record(movements, { type: 'sold', quantity: 5 });
    record(movements, { type: 'returned', quantity: 2 });

    const sold = movements[2]!;
    const check = checkVoid(computeStock(movements), sold);
    expect(check.ok && check.after).toEqual(makeStock(72, 28));

    sold.voidedAt = '2026-10-01T12:00:00.000Z';
    expect(computeStock(movements)).toEqual(makeStock(72, 28));
    expect(movements).toHaveLength(4);
  });

  it('qoldiq manfiy bo\'ladigan bo\'lsa, ruxsat bermaydi', () => {
    const movements: Movement[] = [];
    record(movements, { type: 'received', quantity: 100 });
    record(movements, { type: 'to_uzum', quantity: 70 });

    const r = checkVoid(computeStock(movements), movements[0]!);
    expect(!r.ok && r.error).toEqual({ code: 'VOID_GOES_NEGATIVE', location: 'own', available: 30, needed: 100 });
    if (!r.ok) expect(formatRuleError(r.error)).toContain('−70');
  });

  it('jo\'natishni bekor qilish Uzumda yetarli bo\'lishini talab qiladi', () => {
    const movements: Movement[] = [];
    record(movements, { type: 'received', quantity: 10 });
    record(movements, { type: 'to_uzum', quantity: 10 });
    record(movements, { type: 'sold', quantity: 8 });

    const r = checkVoid(computeStock(movements), movements[1]!);
    expect(!r.ok && r.error).toMatchObject({ code: 'VOID_GOES_NEGATIVE', location: 'uzum' });
  });

  it('ikki marta bekor qilib bo\'lmaydi', () => {
    const m = mv({ type: 'received', quantity: 1, voidedAt: '2026-10-01T00:00:00.000Z' });
    const r = checkVoid(EMPTY_STOCK, m);
    expect(!r.ok && r.error.code).toBe('ALREADY_VOIDED');
  });
});

describe('FBS: sotuv va qaytarish omborimga ta\'sir qiladi', () => {
  it('FBS sotuv omborimdan, FBO sotuv Uzumdan ayiriladi', () => {
    expect(movementEffect({ type: 'sold', quantity: 2, location: 'own', direction: null })).toEqual({ own: -2, uzum: 0 });
    expect(movementEffect({ type: 'sold', quantity: 2, location: 'uzum', direction: null })).toEqual({ own: 0, uzum: -2 });
    expect(movementEffect({ type: 'returned', quantity: 1, location: 'own', direction: null })).toEqual({ own: 1, uzum: 0 });
  });

  it('FBS sotuv omborimdagi qoldiq bilan tekshiriladi', () => {
    const r = previewMovement(makeStock(3, 50), { type: 'sold', quantity: 4, location: 'own' });
    expect(!r.ok && r.error).toMatchObject({ code: 'NOT_ENOUGH', location: 'own', available: 3 });
  });
});

describe('isLowStock', () => {
  it('jami chegaraga teng yoki kam bo\'lsa — tugab qolmoqda', () => {
    expect(isLowStock(makeStock(5, 5), 10)).toBe(true);
    expect(isLowStock(makeStock(6, 5), 10)).toBe(false);
  });
});

describe('variantlar (Uzumdagi kabi kartochka ichida)', () => {
  it('xususiyatlardan barcha kombinatsiyalar yasaladi', () => {
    const rows = buildVariantMatrix([
      { name: 'Rang', values: ['Qora', 'Oq'] },
      { name: "O'lcham", values: ['M', 'L', 'XL'] },
    ]);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual([{ name: 'Rang', value: 'Qora' }, { name: "O'lcham", value: 'M' }]);
    expect(variantLabel(rows[5]!)).toBe('Oq · XL');
  });

  it("bo'sh va takror qiymatlar tashlanadi, xususiyat bo'lmasa — bitta variant", () => {
    expect(buildVariantMatrix([{ name: 'Rang', values: ['Qora', ' qora ', ''] }])).toEqual([[{ name: 'Rang', value: 'qora' }]]);
    expect(buildVariantMatrix([])).toEqual([[]]);
    expect(buildVariantMatrix([{ name: '', values: ['x'] }])).toEqual([[]]);
  });

  it('artikul taklif qilinadi va solishtirishda harf katta-kichikligi farq qilmaydi', () => {
    expect(suggestCode('hoodie', [{ name: 'Rang', value: 'Och kulrang' }, { name: "O'lcham", value: 'L' }])).toBe('HOODIE-OCH-KULRANG-L');
    expect(normalizeCode(' dinamuz-jordan-бежев-l ')).toBe('DINAMUZ-JORDAN-БЕЖЕВ-L');
  });
});
