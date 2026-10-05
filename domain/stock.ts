// Qoldiq hisoblash — sof funksiyalar. Qoldiq hech qachon saqlanmaydi, har doim harakatlardan hisoblanadi.
import type { Location, Movement, MovementEffectInput, Stock } from './types.ts';

export interface Effect {
  own: number;
  uzum: number;
}

export const EMPTY_STOCK: Stock = Object.freeze({ own: 0, uzum: 0, total: 0 });

export function makeStock(own: number, uzum: number): Stock {
  return { own, uzum, total: own + uzum };
}

function at(location: Location | null, amount: number): Effect {
  return location === 'uzum' ? { own: 0, uzum: amount } : { own: amount, uzum: 0 };
}

/** Bitta harakatning omborim va Uzumdagi qoldiqqa ta'siri. */
export function movementEffect(m: MovementEffectInput): Effect {
  const q = m.quantity;
  switch (m.type) {
    case 'received':
      return { own: q, uzum: 0 };
    case 'to_uzum':
      return { own: -q, uzum: q };
    case 'sold':
      // FBO — Uzum omboridan; FBS — sotuvchi o'z omboridan jo'natadi (location: 'own').
      return m.location === 'own' ? { own: -q, uzum: 0 } : { own: 0, uzum: -q };
    case 'returned':
      // Uzum omboridan sotuvchiga qaytdi; FBS'da xaridor to'g'ridan-to'g'ri omborimga qaytaradi.
      return m.location === 'own' ? { own: q, uzum: 0 } : { own: q, uzum: -q };
    case 'written_off':
      return at(m.location, -q);
    case 'adjustment':
      return at(m.location, m.direction === 'decrease' ? -q : q);
  }
}

export function applyEffect(stock: Stock, effect: Effect, sign: 1 | -1 = 1): Stock {
  return makeStock(stock.own + sign * effect.own, stock.uzum + sign * effect.uzum);
}

export function isVoided(m: Pick<Movement, 'voidedAt'>): boolean {
  return m.voidedAt !== null;
}

/** Bitta mahsulot harakatlaridan qoldiq. Bekor qilinganlar hisobga olinmaydi. */
export function computeStock(movements: readonly Movement[]): Stock {
  let own = 0;
  let uzum = 0;
  for (const m of movements) {
    if (isVoided(m)) continue;
    const e = movementEffect(m);
    own += e.own;
    uzum += e.uzum;
  }
  return makeStock(own, uzum);
}

/** Barcha harakatlardan har bir variant qoldig'i. */
export function computeStockByVariant(movements: readonly Movement[]): Map<string, Stock> {
  const byVariant = new Map<string, Movement[]>();
  for (const m of movements) {
    const list = byVariant.get(m.variantId);
    if (list) list.push(m);
    else byVariant.set(m.variantId, [m]);
  }
  const result = new Map<string, Stock>();
  for (const [variantId, list] of byVariant) result.set(variantId, computeStock(list));
  return result;
}

export function sumStocks(stocks: Iterable<Stock>): Stock {
  let own = 0;
  let uzum = 0;
  for (const s of stocks) {
    own += s.own;
    uzum += s.uzum;
  }
  return makeStock(own, uzum);
}

export function isLowStock(stock: Stock, threshold: number): boolean {
  return stock.total <= threshold;
}
