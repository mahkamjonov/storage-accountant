// Mahsulotlar — asosiy sahifa: do'kon tanlash, qidiruv, holat bo'yicha toifalar, ustunlar bo'yicha saralash
// va shu sahifaning o'zida "Omborga qo'shish" (har bir SKU yoniga son yoziladi, bitta tugma bilan saqlanadi).
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ProductWithStock, Stock, VariantWithStock } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { matchesVariant } from '../components/ProductPicker.tsx';
import { ScopePicker } from '../components/ScopePicker.tsx';
import { useToast } from '../components/Toast.tsx';
import { Empty, ErrorBox, SearchInput, SkeletonList, Thumb } from '../components/ui.tsx';
import { num, variantName } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { ACTION_LABEL, MAIN_TYPE } from '../movementUi.ts';
import { useShop } from '../shop.tsx';

type Category = 'all' | 'low' | 'out' | 'transit';

/** SKU qaysi toifaga tushadi. */
const MATCH: Record<Exclude<Category, 'all'>, (v: VariantWithStock) => boolean> = {
  low: (v) => v.low && v.stock.total > 0,
  out: (v) => v.stock.total === 0,
  transit: (v) => v.transit > 0,
};

const CATEGORIES: { id: Category; label: string; meta: string }[] = [
  { id: 'all', label: 'Barchasi', meta: '' },
  { id: 'low', label: 'Tugayapti', meta: 'tugayapti' },
  { id: 'out', label: 'Qolmaganlar', meta: 'qolmagan' },
  { id: 'transit', label: 'Yetkazishdagilar', meta: 'yetkazishda' },
];

type SortKey = 'own' | 'transit' | 'uzum' | 'total';
interface Sort {
  key: SortKey;
  dir: 'desc' | 'asc';
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'own', label: 'Omborda' },
  { key: 'transit', label: 'Yetkazishda' },
  { key: 'uzum', label: 'Uzumda' },
  { key: 'total', label: 'Jami' },
];

/** Ustundagi son: "Uzumda" — sotuvdagisi (yetkazishdagisiz). */
function valueOf(x: { stock: Stock; transit: number }, key: SortKey): number {
  if (key === 'transit') return x.transit;
  if (key === 'uzum') return x.stock.uzum - x.transit;
  return x.stock[key];
}

function sorted<T extends { stock: Stock; transit: number }>(list: T[], sort: Sort | null): T[] {
  if (!sort) return list;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => sign * (valueOf(a, sort.key) - valueOf(b, sort.key)));
}

function variantsIn(p: ProductWithStock, category: Category): VariantWithStock[] {
  return category === 'all' ? p.variants : p.variants.filter(MATCH[category]);
}

export function ProductsPage() {
  const { shops, uzumLinked, allShops } = useShop();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [sort, setSort] = useState<Sort | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Omborga qo'shish rejimi: SKU id → yozilgan son.
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const state = useAsync(() => api.products({ all: allShops }), [allShops]);
  const products = useMemo(() => state.data?.products ?? [], [state.data]);
  const shopName = useMemo(() => new Map(shops.map((s) => [s.id, s.name])), [shops]);
  // "Yetkazishda" ustuni Uzum do'konlarida (barcha do'konlar ko'rinishida — Uzum do'koni bo'lsa).
  const showTransit = allShops ? shops.some((s) => s.uzumShopId != null) : uzumLinked;
  const columns = COLUMNS.filter((c) => showTransit || c.key !== 'transit');

  const counts = useMemo(() => {
    const c: Record<Category, number> = { all: products.length, low: 0, out: 0, transit: 0 };
    for (const p of products) {
      if (p.variants.some(MATCH.low)) c.low += 1;
      if (p.variants.some(MATCH.out)) c.out += 1;
      if (p.variants.some(MATCH.transit)) c.transit += 1;
    }
    return c;
  }, [products]);

  const searching = query.trim() !== '';
  const visible = sorted(
    products.filter((p) => variantsIn(p, category).length > 0 && matchesVariant(p, null, query)),
    sort,
  );
  const categoryMeta = CATEGORIES.find((c) => c.id === category)!.meta;
  const skusFor = (p: ProductWithStock) => {
    const matching = variantsIn(p, category);
    return sorted(searching ? matching.filter((v) => matchesVariant(p, v, query) || matchesVariant(p, null, query)) : matching, sort);
  };

  const filled = Object.entries(qty).filter(([, v]) => Number(v) > 0);
  const addedTotal = filled.reduce((n, [, v]) => n + Number(v), 0);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cycleSort(key: SortKey) {
    setSort((s) => (s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null));
  }

  function stopAdding() {
    setAdding(false);
    setQty({});
  }

  async function saveAdded() {
    if (!filled.length || saving) return;
    setSaving(true);
    try {
      const result = await api.recordBatch({
        type: 'received',
        items: filled.map(([variantId, v]) => ({ variantId, quantity: Number(v) })),
      });
      const ids = result.movements.map((m) => m.id);
      toast.show({
        tone: 'ok',
        message: `Omborga qo'shildi: ${num(addedTotal)} ta`,
        action: {
          label: 'Bekor qilish',
          run: async () => {
            await api.voidBatch(ids);
            return 'Bekor qilindi';
          },
        },
      });
      stopAdding();
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`page products-page${adding ? ' is-adding' : ''}`}>
      <PageHeader
        title="Mahsulotlar"
        subtitle={<ScopePicker />}
        actions={
          !adding && (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setAdding(true)} disabled={products.length === 0}>
              <Icon name="plus" size={20} />
              {ACTION_LABEL[MAIN_TYPE]}
            </button>
          )
        }
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Nom, rang, o'lcham yoki artikul" />

      <div className="chips" role="tablist" aria-label="Toifalar">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category === c.id}
            className={`chip-tab chip-tab--${c.id}${category === c.id ? ' is-active' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
            <span className="chip-tab__count">{num(counts[c.id])}</span>
          </button>
        ))}
      </div>

      {state.loading && !state.data ? (
        <SkeletonList rows={5} />
      ) : state.error ? (
        <ErrorBox error={state.error} onRetry={state.reload} />
      ) : products.length === 0 ? (
        uzumLinked || allShops ? (
          <Empty title="Hali mahsulot yo'q">Uzumdagi mahsulotlaringiz bir necha daqiqada o'zi chiqadi.</Empty>
        ) : (
          <Empty
            title="Hali mahsulot yo'q"
            action={
              <Link to="/mahsulotlar/yangi" className="btn btn--primary">
                <Icon name="plus" size={20} />
                Mahsulot qo'shish
              </Link>
            }
          >
            Kartochka qo'shing va ichida rang, o'lcham kabi SKU'larni yarating.
          </Empty>
        )
      ) : visible.length === 0 ? (
        searching ? (
          <Empty title={`"${query}" topilmadi`}>Boshqacha yozib ko'ring.</Empty>
        ) : (
          <Empty title="Bu yerda hozircha mahsulot yo'q" />
        )
      ) : (
        <>
          <div className={`table-head${showTransit ? ' table-head--4' : ''}`} role="toolbar" aria-label="Saralash">
            <span className="table-head__name">Mahsulot</span>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`sort-btn${active ? ' is-active' : ''}`}
                  onClick={() => cycleSort(c.key)}
                  aria-label={`${c.label} bo'yicha saralash`}
                  aria-pressed={active}
                >
                  <Icon name={active ? (sort!.dir === 'desc' ? 'sort-desc' : 'sort-asc') : 'sort'} size={13} />
                  {c.label}
                </button>
              );
            })}
          </div>

          {adding ? (
            <ul className="cards" role="list">
              {visible.map((p) => (
                <AddCard key={p.id} product={p} variants={skusFor(p)} shopName={allShops ? shopName.get(p.shopId) : undefined} qty={qty} onQty={setQty} />
              ))}
            </ul>
          ) : (
            <ul className="cards" role="list">
              {visible.map((p) => {
                const matching = variantsIn(p, category);
                const filtered = category !== 'all' || searching;
                return (
                  <ProductCard
                    key={p.id}
                    product={p}
                    variants={skusFor(p)}
                    // Toifa yoki qidiruvda mos SKU'lar darrov ko'rinadi.
                    open={open.has(p.id) !== (filtered && p.variants.length > 1)}
                    shopName={allShops ? shopName.get(p.shopId) : undefined}
                    categoryMeta={category !== 'all' && p.variants.length > 1 ? `${matching.length} ta SKU ${categoryMeta}` : undefined}
                    transit={showTransit}
                    onToggle={() => toggle(p.id)}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      {adding && (
        <div className="add-bar" role="region" aria-label="Omborga qo'shish">
          <span className="add-bar__text">
            {filled.length ? (
              <>
                {filled.length} ta SKU · <b>+{num(addedTotal)}</b>
              </>
            ) : (
              'Kelgan sonlarni yozing'
            )}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={stopAdding} disabled={saving}>
            Bekor
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={saveAdded} disabled={!filled.length || saving}>
            <Icon name="check" size={18} />
            {saving ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      )}
    </div>
  );
}

/** `transit` — "Yetkazishda" ustuni; "Uzumda" esa sotuvdagisi. */
function Numbers({ stock, transit, low }: { stock: Stock; transit: number | null; low?: boolean }) {
  return (
    <span className={`product-row__nums${transit !== null ? ' product-row__nums--4' : ''}`}>
      <span className="num-cell num-cell--own">
        <small>Omborda</small>
        {num(stock.own)}
      </span>
      {transit !== null && (
        <span className={`num-cell num-cell--transit${transit > 0 ? ' is-active' : ''}`}>
          <small>Yetkazishda</small>
          {num(transit)}
        </span>
      )}
      <span className="num-cell num-cell--uzum">
        <small>Uzumda</small>
        {num(stock.uzum - (transit ?? 0))}
      </span>
      <span className={`num-cell num-cell--total${low ? ' is-low' : ''}`}>
        <small>Jami</small>
        {num(stock.total)}
      </span>
    </span>
  );
}

function ProductCard({
  product: p,
  variants,
  open,
  shopName,
  categoryMeta,
  transit,
  onToggle,
}: {
  product: ProductWithStock;
  variants: VariantWithStock[];
  open: boolean;
  /** "Barcha do'konlar" ko'rinishida — qaysi do'kondan. */
  shopName?: string;
  /** Toifa tanlanganda: "2 ta SKU tugayapti". */
  categoryMeta?: string;
  transit: boolean;
  onToggle: () => void;
}) {
  const single = p.variants.length <= 1;
  const lowCount = p.variants.filter(MATCH.low).length;
  const defaultMeta = single
    ? (p.variants[0]?.attributes.length ? variantName(p.variants[0]) : '') || null
    : `${p.variants.length} ta SKU${lowCount ? ` · ${lowCount} tasi tugayapti` : ''}`;
  const metaText = [shopName, categoryMeta ?? defaultMeta].filter(Boolean).join(' · ');

  return (
    <li className="card-item">
      <div className="card-item__head">
        {!single && (
          <button
            type="button"
            className={`icon-btn card-item__toggle${open ? ' is-open' : ''}`}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? "SKU'larni yopish" : "SKU'larni ko'rsatish"}
          >
            <Icon name="expand" size={20} />
          </button>
        )}
        <Link to={`/mahsulotlar/${p.id}`} className={`row row--link product-row${single ? ' product-row--single' : ''}`}>
          <span className="row__lead">
            <Thumb src={p.image} />
            <span className="row__main">
              <span className="row__title">
                <span className="clamp-2">{p.name}</span>
              </span>
              {metaText && <span className="row__meta">{metaText}</span>}
            </span>
          </span>
          <Numbers stock={p.stock} transit={transit ? p.transit : null} low={p.low} />
        </Link>
      </div>
      {open && !single && (
        <ul className="variant-rows" role="list">
          {variants.map((v) => (
            <li key={v.id}>
              <Link to={`/mahsulotlar/${p.id}`} className="row row--link product-row variant-row">
                <span className="row__lead">
                  <Thumb src={v.image} />
                  <span className="row__main">
                    <span className="row__title">
                      <span className="clamp-2">{variantName(v)}</span>
                    </span>
                    {v.code && <span className="row__meta">{v.code}</span>}
                  </span>
                </span>
                <Numbers stock={v.stock} transit={transit ? v.transit : null} low={v.low} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Enter — keyingi SKU maydoniga o'tish. */
function nextField(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const all = [...document.querySelectorAll<HTMLInputElement>('.add-row__input')];
  all[all.indexOf(e.currentTarget) + 1]?.focus();
}

/** Omborga qo'shish rejimidagi kartochka: har bir SKU yonida son maydoni. */
function AddCard({
  product: p,
  variants,
  shopName,
  qty,
  onQty,
}: {
  product: ProductWithStock;
  variants: VariantWithStock[];
  shopName?: string;
  qty: Record<string, string>;
  onQty: (fn: (q: Record<string, string>) => Record<string, string>) => void;
}) {
  const single = p.variants.length <= 1;
  return (
    <li className="card-item add-card">
      <div className="add-card__head">
        <Thumb src={p.image} />
        <span className="row__main">
          <span className="row__title">
            <span className="clamp-2">{p.name}</span>
          </span>
          {shopName && <span className="row__meta">{shopName}</span>}
        </span>
      </div>
      <ul className="add-card__rows" role="list">
        {variants.map((v) => {
          const value = qty[v.id] ?? '';
          const label = single && !v.attributes.length ? 'Soni' : variantName(v);
          return (
            <li key={v.id}>
              <label className={`add-row${Number(value) > 0 ? ' is-filled' : ''}`}>
                {!single && <Thumb src={v.image} />}
                <span className="add-row__text">
                  <span className="add-row__name">{label}</span>
                  <span className="add-row__now">Omborda {num(v.stock.own)}</span>
                </span>
                <input
                  className="add-row__input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="0"
                  aria-label={`${p.name}, ${label}: nechta keldi`}
                  value={value}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={nextField}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
                    onQty((q) => {
                      const next = { ...q };
                      if (clean && clean !== '0') next[v.id] = clean;
                      else delete next[v.id];
                      return next;
                    });
                  }}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
