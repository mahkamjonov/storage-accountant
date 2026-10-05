// Bosh sahifa: qoldiq, "Mahsulot keldi", bugun Uzumdan kelganlar va tugab qolayotganlar. Faqat kerakli narsa.
import { Link } from 'react-router-dom';
import { TYPE_LABEL, type MovementType } from '../../../domain/index.ts';
import { api, type Overview } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { UzumBanner } from '../components/UzumBanner.tsx';
import { Empty, ErrorBox, StockFigures } from '../components/ui.tsx';
import { fullName, num } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { entryPath, EXTRA_TYPES, MAIN_TYPE, MANUAL_UZUM_TYPES } from '../movementUi.ts';
import { useShop } from '../shop.tsx';

export function HomePage() {
  const overview = useAsync(() => api.overview(), []);
  const data = overview.data;
  const { shop, uzumLinked } = useShop();
  const tiles: MovementType[] = [...EXTRA_TYPES, ...(uzumLinked ? [] : MANUAL_UZUM_TYPES)];

  return (
    <div className="page page--home">
      <h1 className="home-title">{shop?.name ?? 'Ombor'}</h1>

      <UzumBanner />

      <section className="home-grid">
        <div className="home-grid__summary">
          <section className="card summary" aria-label="Qoldiq">
            {overview.error ? (
              <ErrorBox error={overview.error} onRetry={overview.reload} />
            ) : data ? (
              <StockFigures stock={data.totals} size="lg" />
            ) : (
              <div className="figures figures--lg is-loading" aria-label="Yuklanmoqda" />
            )}
          </section>

          <Link to={entryPath(MAIN_TYPE)} state={{ from: '/' }} className="hero-action">
            <span className="hero-action__icon">
              <Icon name="received" size={28} />
            </span>
            <span className="hero-action__label">{TYPE_LABEL[MAIN_TYPE]}</span>
            <Icon name="chevron" size={22} className="hero-action__chevron" />
          </Link>

          <div className={`tiles${tiles.length > 2 ? ' tiles--many' : ''}`}>
            {tiles.map((t) => (
              <Link key={t} to={entryPath(t)} state={{ from: '/' }} className={`tile action--${t}`}>
                <span className="action__icon">
                  <Icon name={t} size={20} />
                </span>
                <span className="tile__label">{TYPE_LABEL[t]}</span>
              </Link>
            ))}
          </div>

          {uzumLinked && data && <UzumToday today={data.uzumToday} />}
        </div>

        <div className="home-grid__low">
          {data && data.productCount === 0 ? (
            <Empty
              title="Hali mahsulot yo'q"
              action={
                <Link to={uzumLinked ? '/uzum' : '/mahsulotlar/yangi'} className="btn btn--primary">
                  <Icon name={uzumLinked ? 'uzum' : 'plus'} size={20} />
                  {uzumLinked ? 'Uzumdan import qilish' : "Mahsulot qo'shish"}
                </Link>
              }
            />
          ) : (
            data &&
            data.low.length > 0 && (
              <section aria-labelledby="low-title">
                <h2 id="low-title" className="section-title">
                  Tugab qolmoqda
                </h2>
                <ul className="list" role="list">
                  {data.low.map(({ productId, productName, variant: v }) => (
                    <li key={v.id}>
                      <Link to={`/mahsulotlar/${productId}`} className="row row--link">
                        <span className="row__main">
                          <span className="row__title">{fullName({ name: productName }, v)}</span>
                          <span className="row__meta">
                            Omborda {num(v.stock.own)} · Uzumda {num(v.stock.uzum)}
                          </span>
                        </span>
                        <span className={`badge ${v.stock.total === 0 ? 'badge--danger' : 'badge--warn'}`}>
                          {v.stock.total === 0 ? 'Tugadi' : `${num(v.stock.total)} ta`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          )}
        </div>
      </section>
    </div>
  );
}

/** Bugun Uzumdan avtomatik kelganlar. Hech narsa bo'lmasa — ko'rsatilmaydi. */
function UzumToday({ today }: { today: Overview['uzumToday'] }) {
  const items = [
    { label: "Jo'natildi", value: today.to_uzum },
    { label: 'Sotildi', value: today.sold_fbo },
    { label: 'Sotildi (FBS)', value: today.sold_fbs },
    { label: 'Qaytdi', value: today.returned },
  ].filter((i) => i.value > 0);
  if (items.length === 0) return null;
  return (
    <Link to="/tarix" className="card uzum-today">
      <span className="uzum-today__title">Bugun Uzumdan</span>
      <span className="uzum-today__list">
        {items.map((i) => (
          <span key={i.label} className="uzum-today__item">
            {i.label} <b>{num(i.value)}</b>
          </span>
        ))}
      </span>
    </Link>
  );
}
