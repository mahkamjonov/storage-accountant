// Harakatlar ro'yxati (Tarix va Mahsulot sahifasi uchun), sana bo'yicha guruhlangan.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatDateLabel,
  LOCATION_LABEL,
  movementTitle,
  todayIso,
  TYPE_LABEL,
  type Movement,
  type ProductWithStock,
  type VariantWithStock,
} from '../../../domain/index.ts';
import { api } from '../api.ts';
import { effectParts, fullName, num, signed, timeOf, variantName } from '../format.ts';
import { Icon } from './Icon.tsx';
import { useToast } from './Toast.tsx';
import { ConfirmDialog } from './ui.tsx';

function groupByDate(movements: Movement[]): [string, Movement[]][] {
  const groups = new Map<string, Movement[]>();
  for (const m of movements) {
    const list = groups.get(m.date);
    if (list) list.push(m);
    else groups.set(m.date, [m]);
  }
  return [...groups];
}

export interface VariantRef {
  product: ProductWithStock;
  variant: VariantWithStock;
}

/** variantId → kartochka va variant (ro'yxatda nomlarni ko'rsatish uchun). */
export function variantLookup(products: ProductWithStock[]): Map<string, VariantRef> {
  const map = new Map<string, VariantRef>();
  for (const product of products) for (const variant of product.variants) map.set(variant.id, { product, variant });
  return map;
}

export function MovementList({
  movements,
  lookup,
  show,
}: {
  movements: Movement[];
  lookup: Map<string, VariantRef>;
  /** full — kartochka va variant nomi (Tarix); variant — faqat variant (mahsulot sahifasi); none — hech narsa. */
  show: 'full' | 'variant' | 'none';
}) {
  const toast = useToast();
  const [voiding, setVoiding] = useState<Movement | null>(null);

  return (
    <>
      {groupByDate(movements).map(([date, items]) => (
        <section key={date} className="day">
          <h3 className="day__title">{formatDateLabel(date)}</h3>
          <ul className="list" role="list">
            {items.map((m) => (
              <MovementRow
                key={m.id}
                movement={m}
                target={lookup.get(m.variantId)}
                show={show}
                onVoid={() => setVoiding(m)}
              />
            ))}
          </ul>
        </section>
      ))}

      <ConfirmDialog
        open={voiding !== null}
        title="Yozuvni bekor qilasizmi?"
        confirmLabel="Ha, bekor qilish"
        danger
        onClose={() => setVoiding(null)}
        onConfirm={async () => {
          if (!voiding) return;
          await api.voidMovement(voiding.id);
          setVoiding(null);
          // Ochiq sahifalar o'zi yangilanadi (api.dataChanged).
          toast.show({ tone: 'ok', message: 'Bekor qilindi. Qoldiq qayta hisoblandi.' });
        }}
      >
        {voiding && (
          <>
            <p>
              <b>{movementTitle(voiding)}</b>, {num(voiding.quantity)} ta
              {lookup.get(voiding.variantId)
                ? ` — ${fullName(lookup.get(voiding.variantId)!.product, lookup.get(voiding.variantId)!.variant)}`
                : ''}
              .
            </p>
            <p>Qoldiq qayta hisoblanadi. Yozuv o'chmaydi — tarixda "bekor qilingan" bo'lib turadi.</p>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}

function MovementRow({
  movement: m,
  target,
  show,
  onVoid,
}: {
  movement: Movement;
  target: VariantRef | undefined;
  show: 'full' | 'variant' | 'none';
  onVoid: () => void;
}) {
  const voided = m.voidedAt !== null;
  const parts = effectParts(m);
  const detail =
    m.type === 'adjustment' && m.location
      ? `${LOCATION_LABEL[m.location]}: sanaldi ${num(m.countedQuantity ?? m.quantity)} ta`
      : m.type === 'written_off' && m.location
        ? LOCATION_LABEL[m.location]
        : null;

  return (
    <li className={`move${voided ? ' is-voided' : ''}`}>
      <span className={`move__icon move__icon--${m.type}`}>
        <Icon name={m.type} size={20} />
      </span>
      <div className="move__body">
        <div className="move__top">
          <span className="move__type">{movementTitle(m)}</span>
          {m.source === 'uzum' && <span className="badge badge--uzum">Uzum</span>}
          {voided && <span className="badge badge--muted">Bekor qilingan</span>}
        </div>
        {show === 'full' && target && (
          <Link to={`/mahsulotlar/${target.product.id}`} className="move__product">
            {fullName(target.product, target.variant)}
            {target.variant.code ? <span className="move__code"> · {target.variant.code}</span> : null}
          </Link>
        )}
        {show === 'variant' && target && <span className="move__product">{variantName(target.variant)}</span>}
        <div className="move__effects">
          {parts.map((p) => (
            <span key={p.location} className={`delta delta--${p.delta > 0 ? 'in' : 'out'}`}>
              {p.label} <b>{signed(p.delta)}</b>
            </span>
          ))}
        </div>
        {(detail || m.note || m.sourceLabel) && (
          <p className="move__note">{[m.sourceLabel, detail, m.note].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      <div className="move__side">
        {/* Vaqt faqat yozuv o'sha kuni kiritilgan bo'lsa ma'noli. */}
        {todayIso(new Date(m.createdAt)) === m.date && <span className="move__time">{timeOf(m.createdAt)}</span>}
        {!voided && (
          <button type="button" className="link-btn" onClick={onVoid}>
            Bekor qilish
          </button>
        )}
      </div>
    </li>
  );
}
