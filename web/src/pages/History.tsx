import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MOVEMENT_TYPES, TYPE_LABEL, type Movement, type MovementType } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { PageHeader } from '../components/Layout.tsx';
import { MovementList, variantLookup } from '../components/MovementList.tsx';
import { Empty, ErrorBox, SkeletonList } from '../components/ui.tsx';
import { useAsync } from '../hooks.ts';

const PAGE = 50;

export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const productId = params.get('mahsulot') ?? '';
  const typeParam = params.get('tur') ?? '';
  const type = (MOVEMENT_TYPES as readonly string[]).includes(typeParam) ? (typeParam as MovementType) : '';

  const products = useAsync(() => api.products(true), []);
  const lookup = useMemo(() => variantLookup(products.data?.products ?? []), [products.data]);
  const sortedProducts = useMemo(
    () => [...(products.data?.products ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [products.data],
  );
  const selected = sortedProducts.find((p) => p.id === productId);

  const first = useAsync(() => api.movements({ productId, type, limit: PAGE }), [productId, type]);
  const [extra, setExtra] = useState<Movement[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    setExtra([]);
    setHasMore(first.data?.hasMore ?? false);
  }, [first.data]);

  const movements = [...(first.data?.movements ?? []), ...extra];

  async function loadMore() {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const r = await api.movements({ productId, type, limit: PAGE, offset: movements.length });
      setExtra((prev) => [...prev, ...r.movements]);
      setHasMore(r.hasMore);
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function setFilter(key: 'mahsulot' | 'tur', value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const filtered = Boolean(productId || type);

  return (
    <div className="page">
      <PageHeader title="Tarix" />

      <div className="filters">
        <label className="filter">
          <span className="field-label">Mahsulot</span>
          <select className="input" value={productId} onChange={(e) => setFilter('mahsulot', e.target.value)}>
            <option value="">Hammasi</option>
            {sortedProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? ' (arxivda)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="field-label">Turi</span>
          <select className="input" value={type} onChange={(e) => setFilter('tur', e.target.value)}>
            <option value="">Hammasi</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(first.loading && !first.data) || (products.loading && !products.data) ? (
        <SkeletonList rows={6} />
      ) : first.error ? (
        <ErrorBox error={first.error} onRetry={first.reload} />
      ) : movements.length === 0 ? (
        <Empty
          title={filtered ? 'Bu filtr bo\'yicha yozuv yo\'q' : "Hali yozuv yo'q"}
          action={
            filtered ? (
              <button type="button" className="btn btn--secondary" onClick={() => setParams({}, { replace: true })}>
                Filtrni tozalash
              </button>
            ) : undefined
          }
        >
          {filtered ? 'Boshqa mahsulot yoki turni tanlab ko\'ring.' : 'Kiritilgan har bir harakat shu yerda ko\'rinadi.'}
        </Empty>
      ) : (
        <>
          <MovementList
            movements={movements}
            lookup={lookup}
            show={!productId ? 'full' : selected && selected.variants.length > 1 ? 'variant' : 'none'}
          />
          {moreError && (
            <p className="notice notice--error" role="alert">
              {moreError}
            </p>
          )}
          {hasMore && (
            <button type="button" className="btn btn--secondary btn--block" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Yuklanmoqda…' : 'Yana ko\'rsatish'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
