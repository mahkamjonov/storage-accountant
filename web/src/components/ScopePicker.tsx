// Mahsulotlar ro'yxati qaysi do'kon(lar)dan: bitta do'kon yoki barchasi. Do'konlar marketplace bo'yicha guruhlanadi.
import { useEffect, useRef, useState } from 'react';
import type { ShopWithStats } from '../../../domain/index.ts';
import { useShop } from '../shop.tsx';
import { Icon } from './Icon.tsx';

/** Hozircha bitta marketplace — Uzum. Ozon, Wildberries qo'shilsa, shu yerga guruh qo'shiladi. */
function marketplaceOf(s: ShopWithStats): string {
  return s.uzumShopId != null ? 'Uzum Market' : "O'z do'konlarim";
}

export function ScopePicker() {
  const { shops, shop, select, allShops, setAllShops } = useShop();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!shop || shops.length <= 1) return null;

  const groups = new Map<string, ShopWithStats[]>();
  for (const s of shops) {
    const key = marketplaceOf(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

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
        <Icon name="store" size={16} />
        <span className="scope-btn__name">{allShops ? "Barcha do'konlar" : shop.name}</span>
        <Icon name="expand" size={14} className="scope-btn__chevron" />
      </button>

      <dialog ref={ref} className="dialog shop-dialog" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} aria-labelledby="scope-title">
        <div className="dialog__header">
          <h2 id="scope-title" className="dialog__title">
            Qaysi do'kon?
          </h2>
          <button type="button" className="icon-btn" aria-label="Yopish" onClick={() => setOpen(false)}>
            <Icon name="close" />
          </button>
        </div>
        <ul className="list" role="list">
          <li>
            <ScopeOption title="Barcha do'konlar" current={allShops} onClick={() => choose(null)} />
          </li>
        </ul>
        {[...groups.entries()].map(([name, list]) => (
          <section key={name} className="scope-group">
            <h3 className="scope-group__title">{name}</h3>
            <ul className="list" role="list">
              {list.map((s) => (
                <li key={s.id}>
                  <ScopeOption
                    title={s.name}
                    current={!allShops && s.id === shop.id}
                    onClick={() => choose(s.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
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
