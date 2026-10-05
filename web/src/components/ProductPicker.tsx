// Harakat kiritishda variantni tanlash: kartochkalar bo'yicha guruhlangan, oxirgi ishlatilganlar tepada.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { variantLabel, type Location, type ProductWithStock, type VariantWithStock } from '../../../domain/index.ts';
import { num, variantName } from '../format.ts';
import { normalizeSearch } from '../hooks.ts';
import { Icon } from './Icon.tsx';
import { Empty, SearchInput } from './ui.tsx';

/** Qidiruv: kartochka nomi, variant xususiyatlari va artikul bo'yicha; har bir so'z topilishi kerak. */
export function matchesVariant(p: ProductWithStock, v: VariantWithStock | null, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const parts = [p.name, ...(v ? [variantLabel(v.attributes), v.code] : p.variants.flatMap((x) => [variantLabel(x.attributes), x.code]))];
  const hay = normalizeSearch(parts.filter(Boolean).join(' '));
  return q.split(' ').every((word) => hay.includes(word));
}

function recent(a: string | null, b: string | null): number {
  if (a && b) return b.localeCompare(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

export function VariantPicker({
  products,
  highlight,
  onPick,
  createNext,
}: {
  products: ProductWithStock[];
  /** Shu joydagi qoldiq ajratib ko'rsatiladi (masalan, jo'natishda — omborim). */
  highlight: Location | null;
  onPick: (p: ProductWithStock, v: VariantWithStock) => void;
  /** Yangi mahsulot qo'shilgandan keyin qaytiladigan manzil. */
  createNext: string;
}) {
  const [query, setQuery] = useState('');
  const groups = useMemo(
    () =>
      products
        .map((p) => ({ product: p, variants: p.variants.filter((v) => !v.archived) }))
        .filter((g) => g.variants.length > 0)
        .sort((a, b) => recent(a.product.lastMovementAt, b.product.lastMovementAt) || a.product.name.localeCompare(b.product.name)),
    [products],
  );
  const visible = groups
    .map((g) => ({ ...g, variants: g.variants.filter((v) => matchesVariant(g.product, v, query)) }))
    .filter((g) => g.variants.length > 0);
  const createHref = `/mahsulotlar/yangi?keyin=${encodeURIComponent(createNext)}${query ? `&nom=${encodeURIComponent(query)}` : ''}`;

  if (groups.length === 0) {
    return (
      <Empty
        title="Hali mahsulot yo'q"
        action={
          <Link to={createHref} className="btn btn--primary">
            <Icon name="plus" size={20} />
            Mahsulot qo'shish
          </Link>
        }
      >
        Avval mahsulot qo'shing, keyin harakatni kiritasiz.
      </Empty>
    );
  }

  return (
    <div className="picker">
      <div className="picker__search">
        <SearchInput value={query} onChange={setQuery} placeholder="Nom, rang, o'lcham yoki artikul" />
      </div>
      {visible.length === 0 ? (
        <Empty
          title={`"${query}" topilmadi`}
          action={
            <Link to={createHref} className="btn btn--secondary">
              <Icon name="plus" size={20} />
              Yangi mahsulot qo'shish
            </Link>
          }
        >
          Boshqacha yozib ko'ring yoki yangi mahsulot qo'shing.
        </Empty>
      ) : (
        visible.map(({ product, variants }) => (
          <section key={product.id} className="pick-group">
            <h3 className="pick-group__title">{product.name}</h3>
            <ul className="list" role="list">
              {variants.map((v) => (
                <li key={v.id}>
                  <button type="button" className="row row--button" onClick={() => onPick(product, v)}>
                    <span className="row__main">
                      <span className="row__title">{variantName(v)}</span>
                      {v.code && <span className="row__meta">{v.code}</span>}
                    </span>
                    <span className="row__stock">
                      <span className={`chip chip--own${highlight === 'own' ? ' is-strong' : ''}`}>
                        Omborda <b>{num(v.stock.own)}</b>
                      </span>
                      <span className={`chip chip--uzum${highlight === 'uzum' ? ' is-strong' : ''}`}>
                        Uzumda <b>{num(v.stock.uzum)}</b>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
