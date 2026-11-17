// Mahsulotlar — asosiy sahifa: do'kon tanlash, qidiruv, holat bo'yicha toifalar, ustunlar bo'yicha saralash
// va shu sahifaning o'zida "Omborga qo'shish" (har bir SKU yoniga son yoziladi, bitta tugma bilan saqlanadi).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProductWithStock, Stock, VariantWithStock } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
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
            <span className="row-menu-spacer" aria-hidden="true" />
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

/** `transit` — "Yetkazishda" ustuni; "Uzumda" esa sotuvdagisi. `ownSlot` — "Omborda" o'rnida tahrirlash maydoni. */
function Numbers({ stock, transit, low, ownSlot }: { stock: Stock; transit: number | null; low?: boolean; ownSlot?: ReactNode }) {
  return (
    <span className={`product-row__nums${transit !== null ? ' product-row__nums--4' : ''}`}>
      <span className="num-cell num-cell--own">
        <small>Omborda</small>
        {ownSlot ?? num(stock.own)}
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
  const toast = useToast();
  // Ombordagi sonni shu yerning o'zida tahrirlash: SKU id → yozilgan son.
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const single = p.variants.length <= 1;
  const shown = open || (edit !== null && !single);
  const lowCount = p.variants.filter(MATCH.low).length;
  const defaultMeta = single
    ? (p.variants[0]?.attributes.length ? variantName(p.variants[0]) : '') || null
    : `${p.variants.length} ta SKU${lowCount ? ` · ${lowCount} tasi tugayapti` : ''}`;
  const metaText = [shopName, categoryMeta ?? defaultMeta].filter(Boolean).join(' · ');

  function startEdit(list: VariantWithStock[]) {
    setEdit((e) => ({ ...(e ?? {}), ...Object.fromEntries(list.map((v) => [v.id, String(v.stock.own)])) }));
  }

  const changed = edit ? p.variants.filter((v) => edit[v.id] !== undefined && edit[v.id] !== '' && Number(edit[v.id]) !== v.stock.own) : [];

  async function save() {
    if (saving) return;
    if (!changed.length) {
      setEdit(null);
      return;
    }
    setSaving(true);
    try {
      const result = await api.recordBatch({
        type: 'adjustment',
        location: 'own',
        items: changed.map((v) => ({ variantId: v.id, counted: Number(edit![v.id]) })),
      });
      const ids = result.movements.map((m) => m.id);
      toast.show({
        tone: 'ok',
        message: `Soni yangilandi: ${changed.length} ta SKU`,
        action: {
          label: 'Bekor qilish',
          run: async () => {
            await api.voidBatch(ids);
            return 'Bekor qilindi';
          },
        },
      });
      setEdit(null);
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  function field(v: VariantWithStock) {
    if (!edit || edit[v.id] === undefined) return undefined;
    return (
      <input
        className="own-input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        enterKeyHint="done"
        aria-label={`${single ? p.name : variantName(v)}: omborda nechta`}
        value={edit[v.id]}
        autoFocus={Object.keys(edit)[0] === v.id}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') setEdit(null);
        }}
        onChange={(e) => {
          const clean = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
          setEdit((q) => ({ ...(q ?? {}), [v.id]: clean }));
        }}
      />
    );
  }

  const editItem = (list: VariantWithStock[]) => [{ label: 'Sonini tahrirlash', icon: 'edit' as const, run: () => startEdit(list) }];

  const head = (
    <>
      <span className="row__lead">
        <span className={`card-item__chevron${shown ? ' is-open' : ''}`} aria-hidden="true">
          {!single && <Icon name="expand" size={18} />}
        </span>
        <Thumb src={p.image} />
        <span className="row__main">
          <span className="row__title">
            <span className="clamp-2">{p.name}</span>
          </span>
          {metaText && <span className="row__meta">{metaText}</span>}
        </span>
      </span>
      <Numbers stock={p.stock} transit={transit ? p.transit : null} low={p.low} ownSlot={single && p.variants[0] ? field(p.variants[0]) : undefined} />
    </>
  );

  return (
    <li className={`card-item${edit ? ' is-editing' : ''}`}>
      <div className="card-item__head">
        {/* Kartochka bosilsa — faqat SKU'lari ochiladi/yopiladi. Bitta SKU'li kartochka bosilmaydi. */}
        {single ? (
          <div className="row product-row">{head}</div>
        ) : (
          <button type="button" className="row row--button product-row" onClick={onToggle} aria-expanded={shown}>
            {head}
          </button>
        )}
        <RowMenu label={p.name} items={editItem(p.variants)} />
      </div>
      {shown && !single && (
        <ul className="variant-rows" role="list">
          {variants.map((v) => (
            <li key={v.id} className="variant-rows__item">
              <div className="row product-row variant-row">
                <span className="row__lead">
                  <Thumb src={v.image} />
                  <span className="row__main">
                    <span className="row__title">
                      <span className="clamp-2">{variantName(v)}</span>
                    </span>
                    {v.code && <span className="row__meta">{v.code}</span>}
                  </span>
                </span>
                <Numbers stock={v.stock} transit={transit ? v.transit : null} low={v.low} ownSlot={field(v)} />
              </div>
              <RowMenu label={variantName(v)} items={editItem([v])} />
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <div className="card-edit-bar">
          <span className="card-edit-bar__text">
            {changed.length ? `${changed.length} ta SKU o'zgaradi` : 'Ombordagi sonni yozing'}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEdit(null)} disabled={saving}>
            Bekor
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            <Icon name="check" size={18} />
            {saving ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      )}
    </li>
  );
}

/** "⋮" tugmasi va kichik menyu. Menyu sahifa ustida (fixed) chiziladi — kartochka chegarasida kesilmasin. */
function RowMenu({ label, items }: { label: string; items: { label: string; icon: IconName; run: () => void }[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="icon-btn row-menu-btn"
        aria-label={`${label}: amallar`}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos(pos ? null : { top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
      >
        <Icon name="more" size={20} />
      </button>
      {pos && (
        <>
          <div className="menu-backdrop" onClick={() => setPos(null)} />
          <div className="menu" role="menu" style={{ top: pos.top, right: pos.right }}>
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className="menu__item"
                autoFocus
                onClick={() => {
                  setPos(null);
                  it.run();
                }}
              >
                <Icon name={it.icon} size={18} />
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
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
