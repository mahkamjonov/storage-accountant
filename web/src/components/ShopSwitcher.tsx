// Do'kon tanlash (Uzum seller'dagi kabi). Bitta do'kon bo'lsa — faqat nomi ko'rinadi.
import { useEffect, useRef, useState } from 'react';
import { useShop } from '../shop.tsx';
import { Icon } from './Icon.tsx';

export function ShopSwitcher({ compact }: { compact?: boolean }) {
  const { shops, shop, select } = useShop();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!shop) return null;
  const many = shops.length > 1;

  return (
    <>
      <button
        type="button"
        className={`shop-switch${compact ? ' shop-switch--compact' : ''}`}
        onClick={() => many && setOpen(true)}
        disabled={!many}
        aria-haspopup={many ? 'dialog' : undefined}
      >
        <span className="shop-switch__icon" aria-hidden="true">
          <Icon name="store" size={18} />
        </span>
        <span className="shop-switch__text">
          <span className="shop-switch__label">Do'kon</span>
          <span className="shop-switch__name">{shop.name}</span>
        </span>
        {many && <Icon name="expand" size={18} className="shop-switch__chevron" />}
      </button>

      <dialog ref={ref} className="dialog shop-dialog" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} aria-labelledby="shop-title">
        <div className="dialog__header">
          <h2 id="shop-title" className="dialog__title">
            Do'konni tanlang
          </h2>
          <button type="button" className="icon-btn" aria-label="Yopish" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <p className="dialog__lead">Har bir do'konning mahsulotlari, qoldig'i va tarixi alohida.</p>
        <ul className="list" role="list">
          {shops.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`row row--button shop-option${s.id === shop.id ? ' is-current' : ''}`}
                onClick={() => {
                  if (s.id !== shop.id) select(s.id);
                  setOpen(false);
                }}
                aria-current={s.id === shop.id}
              >
                <span className="row__main">
                  <span className="row__title">{s.name}</span>
                  <span className="row__meta">
                    {s.productCount ? `${s.productCount} ta mahsulot` : "Hali mahsulot yo'q"}
                    {s.uzumShopId !== null ? ' · Uzum' : ''}
                  </span>
                </span>
                {s.id === shop.id && <Icon name="check" size={20} />}
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
