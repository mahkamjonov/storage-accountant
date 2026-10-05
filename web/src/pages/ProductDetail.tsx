import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TYPE_LABEL, type MovementType, type VariantWithStock } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { MovementList, variantLookup } from '../components/MovementList.tsx';
import { useToast } from '../components/Toast.tsx';
import { ConfirmDialog, Empty, ErrorBox, Loading, SkeletonList, StockFigures } from '../components/ui.tsx';
import { num, variantName } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { entryPath, EXTRA_TYPES, MAIN_TYPE, MANUAL_UZUM_TYPES } from '../movementUi.ts';
import { useShop } from '../shop.tsx';

const HISTORY_LIMIT = 100;

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const product = useAsync(() => api.product(id), [id]);
  const history = useAsync(() => api.movements({ productId: id, limit: HISTORY_LIMIT }), [id]);
  const [reconcile, setReconcile] = useState<VariantWithStock | null>(null);
  const toast = useToast();
  const { uzumLinked } = useShop();
  const p = product.data?.product;
  const lookup = useMemo(() => variantLookup(p ? [p] : []), [p]);
  const here = `/mahsulotlar/${id}`;

  if (product.loading && !p) {
    return (
      <div className="page">
        <PageHeader title="Mahsulot" back="/mahsulotlar" />
        <Loading />
      </div>
    );
  }
  if (product.error || !p) {
    return (
      <div className="page">
        <PageHeader title="Mahsulot" back="/mahsulotlar" />
        {product.error ? <ErrorBox error={product.error} onRetry={product.reload} /> : null}
      </div>
    );
  }

  const active = p.variants.filter((v) => !v.archived);
  const single = active.length === 1 ? active[0]! : null;
  // Kiritish sahifasi shu kartochkaning barcha variantlari bilan ochiladi.
  const target = { productId: p.id };
  const types: MovementType[] = [MAIN_TYPE, ...EXTRA_TYPES, ...(uzumLinked ? [] : MANUAL_UZUM_TYPES)];

  return (
    <div className="page">
      <PageHeader
        title={p.name}
        subtitle={
          single
            ? [single.attributes.length ? variantName(single) : null, single.code].filter(Boolean).join(' · ') || undefined
            : `${active.length} ta variant`
        }
        back="/mahsulotlar"
        actions={
          <Link to={`${here}/tahrirlash`} className="btn btn--secondary btn--sm">
            <Icon name="edit" size={18} />
            Tahrirlash
          </Link>
        }
      />

      {p.archived && (
        <p className="notice notice--muted">Bu mahsulot arxivda. Harakat kiritish uchun avval "Tahrirlash" orqali arxivdan chiqaring.</p>
      )}

      <div className="detail-grid">
        <div className="detail-grid__side">
          <section className="card">
            <StockFigures stock={p.stock} size="lg" />
          </section>

          {!p.archived && active.length > 0 && (
            <section aria-label="Harakat kiritish" className="mini-actions">
              {types.map((t) => (
                <Link key={t} to={entryPath(t, target)} state={{ from: here }} className={`mini-action action--${t}${t === MAIN_TYPE ? ' mini-action--main' : ''}`}>
                  <span className="action__icon">
                    <Icon name={t} size={20} />
                  </span>
                  {TYPE_LABEL[t]}
                </Link>
              ))}
            </section>
          )}
        </div>

        <div className="detail-grid__main">
          {!single || p.variants.length > 1 ? (
            <section aria-labelledby="variants-title">
              <h2 id="variants-title" className="section-title">
                Variantlar
              </h2>
              <ul className="list" role="list">
                {p.variants.map((v) => (
                  <VariantRow key={v.id} variant={v} onReconcile={() => setReconcile(v)} />
                ))}
              </ul>
            </section>
          ) : (
            single.uzumReported !== null &&
            single.uzumReported !== single.stock.uzum && <UzumMismatch variant={single} onReconcile={() => setReconcile(single)} />
          )}

          <section aria-labelledby="history-title">
            <h2 id="history-title" className="section-title">
              Tarix
            </h2>
            {history.loading && !history.data ? (
              <SkeletonList />
            ) : history.error ? (
              <ErrorBox error={history.error} onRetry={history.reload} />
            ) : history.data!.movements.length === 0 ? (
              <Empty title="Hali harakat yo'q">Mahsulot kelganda "Mahsulot keldi"ni bosing.</Empty>
            ) : (
              <>
                <MovementList movements={history.data!.movements} lookup={lookup} show={p.variants.length > 1 ? 'variant' : 'none'} />
                {history.data!.hasMore && (
                  <Link to={`/tarix?mahsulot=${p.id}`} className="btn btn--secondary btn--block">
                    To'liq tarixni ko'rish
                  </Link>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={reconcile !== null}
        title="Uzumdagi sonni olaymi?"
        confirmLabel="Ha, tuzatish"
        onClose={() => setReconcile(null)}
        onConfirm={async () => {
          if (!reconcile || reconcile.uzumReported === null) return;
          await api.recordMovement({
            variantId: reconcile.id,
            type: 'adjustment',
            location: 'uzum',
            counted: reconcile.uzumReported,
            note: "Uzum ma'lumoti bo'yicha",
          });
          setReconcile(null);
          toast.show({ tone: 'ok', message: `Uzumdagi qoldiq tuzatildi: ${reconcile.uzumReported} ta` });
        }}
      >
        {reconcile && (
          <p>
            {variantName(reconcile)}: ilovada Uzumda <b>{num(reconcile.stock.uzum)} ta</b>, Uzumning o'zi esa{' '}
            <b>{num(reconcile.uzumReported ?? 0)} ta</b> deyapti. "Sanab tuzatish" yozuvi qo'shiladi va tarixda ko'rinadi.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function UzumMismatch({ variant: v, onReconcile }: { variant: VariantWithStock; onReconcile: () => void }) {
  return (
    <div className="notice notice--warn mismatch">
      <span>
        Uzum ma'lumotiga ko'ra Uzumda <b>{num(v.uzumReported ?? 0)} ta</b> (ilovada {num(v.stock.uzum)} ta).
      </span>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onReconcile}>
        Uzum bo'yicha tuzatish
      </button>
    </div>
  );
}

function VariantRow({ variant: v, onReconcile }: { variant: VariantWithStock; onReconcile: () => void }) {
  const mismatch = !v.archived && v.uzumReported !== null && v.uzumReported !== v.stock.uzum;
  return (
    <li className={`variant-detail${v.archived ? ' is-archived' : ''}`}>
      <div className="variant-detail__main">
        <span className="row__title">
          {variantName(v)}
          {v.low && (
            <span className={`badge ${v.stock.total === 0 ? 'badge--danger' : 'badge--warn'}`}>{v.stock.total === 0 ? 'Tugadi' : 'Kam qoldi'}</span>
          )}
          {v.archived && <span className="badge badge--muted">Arxivda</span>}
        </span>
        <span className="row__meta">
          {v.code ?? "Artikul yo'q"}
          {v.uzumSkuId !== null ? " · Uzum bilan bog'langan" : ''}
        </span>
        {mismatch && (
          <button type="button" className="link-btn link-btn--warn" onClick={onReconcile}>
            Uzum: {num(v.uzumReported ?? 0)} ta — tuzatish
          </button>
        )}
      </div>
      <span className="variant-detail__nums">
        <span className="num-cell num-cell--own">
          <small>Omborda</small>
          {num(v.stock.own)}
        </span>
        <span className="num-cell num-cell--uzum">
          <small>Uzumda</small>
          {num(v.stock.uzum)}
        </span>
        <span className={`num-cell${v.low ? ' is-low' : ''}`}>
          <small>Jami</small>
          {num(v.stock.total)}
        </span>
      </span>
    </li>
  );
}
