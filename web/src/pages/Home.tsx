// Bosh sahifa: jami qoldiq, "Omborga qo'shish" va kam qolgan mahsulotlar. Boshqa hech narsa.
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorBox, StockFigures, Thumb } from '../components/ui.tsx';
import { num, variantName } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { ACTION_LABEL, entryPath, MAIN_TYPE } from '../movementUi.ts';
import { useShop } from '../shop.tsx';

export function HomePage() {
  const overview = useAsync(() => api.overview(), []);
  const data = overview.data;
  const { shop, uzumLinked } = useShop();

  return (
    <div className="page page--home">
      <h1 className="home-title">{shop?.name ?? 'Ombor'}</h1>

      <section className="home-grid">
        <div className="home-grid__summary">
          <section className="card summary" aria-label="Qoldiq">
            {overview.error ? (
              <ErrorBox error={overview.error} onRetry={overview.reload} />
            ) : data ? (
              <StockFigures stock={data.totals} transit={uzumLinked ? data.transit : undefined} size="lg" />
            ) : (
              <div className="figures figures--lg is-loading" aria-label="Yuklanmoqda" />
            )}
          </section>

          <Link to={entryPath(MAIN_TYPE)} state={{ from: '/' }} className="hero-action">
            <Icon name="plus" size={22} />
            {ACTION_LABEL[MAIN_TYPE]}
          </Link>
        </div>

        <div className="home-grid__low">
          {data && data.productCount === 0 ? (
            uzumLinked ? (
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
              />
            )
          ) : (
            data &&
            data.low.length > 0 && (
              <section aria-labelledby="low-title">
                <h2 id="low-title" className="section-title">
                  Kam qolganlar
                </h2>
                <ul className="list" role="list">
                  {data.low.map(({ productId, productName, variant: v }) => (
                    <li key={v.id}>
                      <Link to={`/mahsulotlar/${productId}`} className="row row--link">
                        <Thumb src={v.image} />
                        <span className="row__main">
                          <span className="row__title">
                            <span className="clamp-2">{productName}</span>
                          </span>
                          {v.attributes.length > 0 && <span className="row__meta">{variantName(v)}</span>}
                        </span>
                        <span className="row__stock">
                          <span className="chip chip--own is-strong">
                            Omborda <b>{num(v.stock.own)}</b>
                          </span>
                          {v.transit > 0 && (
                            <span className="chip chip--transit">
                              Yetkazishda <b>{num(v.transit)}</b>
                            </span>
                          )}
                          <span className="chip chip--uzum">
                            Uzumda <b>{num(v.stock.uzum - v.transit)}</b>
                          </span>
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
