// Mahsulotlar: kartochkalar (Uzumdagi kabi), bosilganda ichidagi variantlar ochiladi.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProductWithStock } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { matchesVariant } from '../components/ProductPicker.tsx';
import { Empty, ErrorBox, SearchInput, SkeletonList } from '../components/ui.tsx';
import { num, variantName } from '../format.ts';
import { useAsync } from '../hooks.ts';

export function ProductsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const state = useAsync(() => api.products(showArchived), [showArchived]);
  const products = state.data?.products ?? [];
  const visible = products.filter((p) => matchesVariant(p, null, query));

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="page">
      <PageHeader
        title="Mahsulotlar"
        actions={
          <Link to="/mahsulotlar/yangi" className="btn btn--primary btn--sm">
            <Icon name="plus" size={20} />
            Yangi
          </Link>
        }
      />

      {products.length > 0 && <SearchInput value={query} onChange={setQuery} placeholder="Nom, rang, o'lcham yoki artikul" />}

      {state.loading && !state.data ? (
        <SkeletonList rows={5} />
      ) : state.error ? (
        <ErrorBox error={state.error} onRetry={state.reload} />
      ) : products.length === 0 ? (
        <Empty
          title={showArchived ? "Mahsulot yo'q" : "Hali mahsulot yo'q"}
          action={
            <div className="empty__actions">
              <Link to="/mahsulotlar/yangi" className="btn btn--primary">
                <Icon name="plus" size={20} />
                Mahsulot qo'shish
              </Link>
              <Link to="/uzum" className="btn btn--secondary">
                <Icon name="uzum" size={20} />
                Uzumdan import
              </Link>
            </div>
          }
        >
          Kartochka qo'shing va ichida rang, o'lcham kabi variantlarni yarating — xuddi Uzumdagidek.
        </Empty>
      ) : visible.length === 0 ? (
        <Empty title={`"${query}" topilmadi`}>Boshqacha yozib ko'ring.</Empty>
      ) : (
        <>
          <div className="table-head" aria-hidden="true">
            <span>Mahsulot</span>
            <span>Omborda</span>
            <span>Uzumda</span>
            <span>Jami</span>
          </div>
          <ul className="cards" role="list">
            {visible.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                // Qidiruvda variant topilsa, kartochka ochiq ko'rinadi.
                open={open.has(p.id) || (query.trim() !== '' && p.variants.length > 1)}
                query={query}
                onToggle={() => toggle(p.id)}
              />
            ))}
          </ul>
        </>
      )}

      <label className="toggle">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        <span>Arxivdagilarni ham ko'rsatish</span>
      </label>
    </div>
  );
}

function Numbers({ own, uzum, total, low }: { own: number; uzum: number; total: number; low?: boolean }) {
  return (
    <span className="product-row__nums">
      <span className="num-cell num-cell--own">
        <small>Omborda</small>
        {num(own)}
      </span>
      <span className="num-cell num-cell--uzum">
        <small>Uzumda</small>
        {num(uzum)}
      </span>
      <span className={`num-cell num-cell--total${low ? ' is-low' : ''}`}>
        <small>Jami</small>
        {num(total)}
      </span>
    </span>
  );
}

function ProductCard({
  product: p,
  open,
  query,
  onToggle,
}: {
  product: ProductWithStock;
  open: boolean;
  query: string;
  onToggle: () => void;
}) {
  const single = p.variants.length <= 1;
  const variants = query.trim() ? p.variants.filter((v) => matchesVariant(p, v, query) || matchesVariant(p, null, query)) : p.variants;
  const lowCount = p.variants.filter((v) => v.low).length;

  return (
    <li className={`card-item${p.archived ? ' is-archived' : ''}`}>
      <div className="card-item__head">
        {!single && (
          <button
            type="button"
            className={`icon-btn card-item__toggle${open ? ' is-open' : ''}`}
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? 'Variantlarni yopish' : 'Variantlarni ko\'rsatish'}
          >
            <Icon name="expand" size={20} />
          </button>
        )}
        <Link to={`/mahsulotlar/${p.id}`} className={`row row--link product-row${single ? ' product-row--single' : ''}`}>
          <span className="row__main">
            <span className="row__title">
              {p.name}
              {p.archived && <span className="badge badge--muted">Arxivda</span>}
            </span>
            <span className="row__meta">
              {single
                ? [p.variants[0] && p.variants[0].attributes.length ? variantName(p.variants[0]) : null, p.variants[0]?.code].filter(Boolean).join(' · ') || ' '
                : `${p.variants.length} ta variant${lowCount ? ` · ${lowCount} tasi tugab qolmoqda` : ''}`}
            </span>
          </span>
          <Numbers {...p.stock} low={p.low} />
        </Link>
      </div>
      {open && !single && (
        <ul className="variant-rows" role="list">
          {variants.map((v) => (
            <li key={v.id}>
              <Link to={`/mahsulotlar/${p.id}`} className={`row row--link product-row variant-row${v.archived ? ' is-archived' : ''}`}>
                <span className="row__main">
                  <span className="row__title">{variantName(v)}</span>
                  {v.code && <span className="row__meta">{v.code}</span>}
                </span>
                <Numbers {...v.stock} low={v.low} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
