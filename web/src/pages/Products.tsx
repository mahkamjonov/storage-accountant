// Mahsulotlar — asosiy sahifa: do'kon tanlash, qidiruv, holat bo'yicha toifalar va "Omborga qo'shish".
// Kartochka bosilganda ichidagi SKU'lar ochiladi.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProductWithStock, Stock, VariantWithStock } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { matchesVariant } from '../components/ProductPicker.tsx';
import { ScopePicker } from '../components/ScopePicker.tsx';
import { Empty, ErrorBox, SearchInput, SkeletonList, Thumb } from '../components/ui.tsx';
import { num, variantName } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { ACTION_LABEL, entryPath, MAIN_TYPE } from '../movementUi.ts';
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

function variantsIn(p: ProductWithStock, category: Category): VariantWithStock[] {
  return category === 'all' ? p.variants : p.variants.filter(MATCH[category]);
}

export function ProductsPage() {
  const { shops, uzumLinked, allShops } = useShop();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const state = useAsync(() => api.products({ all: allShops }), [allShops]);
  const products = useMemo(() => state.data?.products ?? [], [state.data]);
  const shopName = useMemo(() => new Map(shops.map((s) => [s.id, s.name])), [shops]);
  // "Yetkazishda" ustuni Uzum do'konlarida (barcha do'konlar ko'rinishida — Uzum do'koni bo'lsa).
  const showTransit = allShops ? shops.some((s) => s.uzumShopId != null) : uzumLinked;

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
  const visible = products.filter((p) => variantsIn(p, category).length > 0 && matchesVariant(p, null, query));
  const categoryMeta = CATEGORIES.find((c) => c.id === category)!.meta;

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="page products-page">
      <PageHeader
        title="Mahsulotlar"
        subtitle={<ScopePicker />}
        actions={
          <Link to={entryPath(MAIN_TYPE)} state={{ from: '/mahsulotlar' }} className="btn btn--primary btn--sm">
            <Icon name="plus" size={20} />
            {ACTION_LABEL[MAIN_TYPE]}
          </Link>
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
          <div className={`table-head${showTransit ? ' table-head--4' : ''}`} aria-hidden="true">
            <span>Mahsulot</span>
            <span>Omborda</span>
            {showTransit && <span>Yetkazishda</span>}
            <span>Uzumda</span>
            <span>Jami</span>
          </div>
          <ul className="cards" role="list">
            {visible.map((p) => {
              const matching = variantsIn(p, category);
              const filtered = category !== 'all' || searching;
              return (
                <ProductCard
                  key={p.id}
                  product={p}
                  variants={searching ? matching.filter((v) => matchesVariant(p, v, query) || matchesVariant(p, null, query)) : matching}
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
        </>
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
