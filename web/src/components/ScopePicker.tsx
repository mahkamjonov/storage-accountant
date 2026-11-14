// Mahsulotlar ro'yxati qaysi do'kon(lar)dan: bitta do'kon yoki barchasi.
// Yuqorida marketplace logolari (gorizontal); bosilganda o'sha marketplace'dagi do'konlar chiqadi.
import { useEffect, useRef, useState } from 'react';
import type { ShopWithStats } from '../../../domain/index.ts';
import { useShop } from '../shop.tsx';
import { Icon } from './Icon.tsx';

interface Marketplace {
  id: 'uzum' | 'ozon' | 'wildberries';
  name: string;
  /** Plitkadagi qisqa nom. */
  short: string;
  logo: string;
  /** Hozircha faqat Uzum ulanadi; qolganlari — tez orada. */
  shopsOf: (shops: ShopWithStats[]) => ShopWithStats[] | null;
}

export const MARKETPLACES: Marketplace[] = [
  { id: 'uzum', name: 'Uzum Market', short: 'Uzum', logo: '/marketplaces/uzum.png', shopsOf: (shops) => shops.filter((s) => s.uzumShopId != null) },
  { id: 'ozon', name: 'Ozon', short: 'Ozon', logo: '/marketplaces/ozon.png', shopsOf: () => null },
  { id: 'wildberries', name: 'Wildberries', short: 'Wildberries', logo: '/marketplaces/wildberries.png', shopsOf: () => null },
];

export function marketplaceLogo(shop: ShopWithStats | null): string | null {
  return shop?.uzumShopId != null ? MARKETPLACES[0]!.logo : null;
}

export function ScopePicker() {
  const { shops, shop, select, allShops, setAllShops } = useShop();
  const [open, setOpen] = useState(false);
  const [market, setMarket] = useState<Marketplace['id']>('uzum');
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!shop) return null;
  const logo = marketplaceLogo(shop);
  const current = MARKETPLACES.find((m) => m.id === market)!;
  const list = current.shopsOf(shops);

  function choose(id: string | null) {
    if (id === null) setAllShops(true);
    else {
      setAllShops(false);
      if (id !== shop!.id) select(id);
    }
    setOpen(false);
  }

  return (
    <>
      <button type="button" className="scope-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {!allShops && logo ? <img src={logo} alt="" className="scope-btn__logo" /> : <Icon name="store" size={16} />}
        <span className="scope-btn__name">{allShops ? "Barcha do'konlar" : shop.name}</span>
        <Icon name="expand" size={14} className="scope-btn__chevron" />
      </button>

      <dialog ref={ref} className="dialog shop-dialog" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} aria-labelledby="scope-title">
        <div className="dialog__header">
          <h2 id="scope-title" className="dialog__title">
            Do'konni tanlang
          </h2>
          <button type="button" className="icon-btn" aria-label="Yopish" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>

        <div className="markets" role="tablist" aria-label="Marketplace">
          {MARKETPLACES.map((m) => {
            const count = m.shopsOf(shops)?.length ?? 0;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={market === m.id}
                className={`market${market === m.id ? ' is-active' : ''}${count ? '' : ' is-off'}`}
                onClick={() => setMarket(m.id)}
              >
                <img src={m.logo} alt="" className="market__logo" />
                <span className="market__name">{m.short}</span>
                <span className="market__meta">{count ? `${count} ta do'kon` : 'Tez orada'}</span>
              </button>
            );
          })}
        </div>

        {list && list.length > 0 ? (
          <ul className="list scope-list" role="list">
            {list.length > 1 && (
              <li>
                <ScopeOption title="Barcha do'konlar" current={allShops} onClick={() => choose(null)} />
              </li>
            )}
            {list.map((s) => (
              <li key={s.id}>
                <ScopeOption title={s.name} current={!allShops && s.id === shop.id} onClick={() => choose(s.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="scope-empty">{current.name} hali ulanmagan. Tez orada qo'shiladi.</p>
        )}
      </dialog>
    </>
  );
}

function ScopeOption({ title, current, onClick }: { title: string; current: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`row row--button shop-option${current ? ' is-current' : ''}`} onClick={onClick} aria-current={current}>
      <span className="row__main">
        <span className="row__title">{title}</span>
      </span>
      {current && <Icon name="check" size={20} />}
    </button>
  );
}
