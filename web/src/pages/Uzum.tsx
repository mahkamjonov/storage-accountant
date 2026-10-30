// Uzum Market: do'kon tanlash, holat, qo'lda yangilash, kutilayotgan va oxirgi yozuvlar. Kartochkalar Uzumdan o'zi qo'shiladi.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDateLabel, type UzumEvent, type UzumEventKind } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { variantLookup, type VariantRef } from '../components/MovementList.tsx';
import { useToast } from '../components/Toast.tsx';
import { ErrorBox, SkeletonList } from '../components/ui.tsx';
import { fullName, num, timeAgo } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { ShopSwitcher } from '../components/ShopSwitcher.tsx';
import { useSession } from '../session.tsx';
import { useShop } from '../shop.tsx';

const KIND_LABEL: Record<UzumEventKind, string> = {
  to_uzum: "Uzumga jo'natildi",
  sold: 'Sotildi',
  returned: 'Qaytdi',
};

export function UzumPage() {
  const status = useAsync(() => api.uzumStatus(), []);
  const s = status.data;

  return (
    <div className="page">
      <PageHeader title="Uzum" />
      <ShopSwitcher />
      {status.loading && !s ? (
        <SkeletonList rows={3} />
      ) : status.error ? (
        <ErrorBox error={status.error} onRetry={status.reload} />
      ) : !s?.configured ? (
        <NotConfigured />
      ) : !s.shopLinked ? (
        <NotLinked />
      ) : (
        <Connected />
      )}
      <Account />
    </div>
  );
}

/** Hisobdan chiqish — kam ishlatiladi, shuning uchun shu yerda, pastda. */
function Account() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  return (
    <div className="account">
      <span>{user?.displayName}</span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={async () => {
          await logout();
          navigate('/kirish');
        }}
      >
        <Icon name="logout" size={18} />
        Chiqish
      </button>
    </div>
  );
}

function NotConfigured() {
  return (
    <section className="card setup">
      <h2 className="setup__title">Uzum hali ulanmagan</h2>
      <p>Ulangandan keyin Uzumdagi har bir nakladnoy omborimdan avtomatik ayiriladi, sotuv va qaytarishlar ham o'zi yoziladi.</p>
      <ol className="steps">
        <li>
          Uzum sotuvchi kabinetida <b>Sozlamalar → API kalitlari</b> bo'limidan kalit yarating.
        </li>
        <li>
          Netlify'da: <b>Site configuration → Environment variables</b> → <code>UZUM_API_KEY</code> qo'shing. Kompyuterda:{' '}
          <code>.env</code> fayliga <code>UZUM_API_KEY=kalitingiz</code>.
        </li>
        <li>Saytni qayta joylang (Netlify: Deploys → Trigger deploy) va shu sahifani yangilang.</li>
      </ol>
      <p className="field-hint">Kalitni hech kimga yubormang va chatga yozmang.</p>
    </section>
  );
}

function NotLinked() {
  return (
    <p className="calm">Bu do'kon Uzumga bog'lanmagan. Yuqoridan Uzum do'konini tanlang.</p>
  );
}

function Connected() {
  const toast = useToast();
  const status = useAsync(() => api.uzumStatus(), []);
  const attention = useAsync(() => api.uzumEvents(['pending', 'unmatched'], 300), []);
  const recent = useAsync(() => api.uzumEvents(['applied', 'cancelled'], 30), []);
  const products = useAsync(() => api.products(true), []);
  const lookup = useMemo(() => variantLookup(products.data?.products ?? []), [products.data]);
  const [syncing, setSyncing] = useState(false);
  const s = status.data;

  async function sync() {
    setSyncing(true);
    try {
      // Serverda bitta so'rov vaqt bilan cheklangan bo'lishi mumkin (Netlify) — tugaguncha davom ettiramiz.
      const c = { applied: 0, cancelled: 0, pending: 0, unmatched: 0, ignored: 0 };
      let imported = 0;
      for (let i = 0; i < 20; i++) {
        const { report } = await api.uzumSync();
        for (const k of Object.keys(c) as (keyof typeof c)[]) c[k] += report.changes[k];
        imported += report.imported;
        if (report.done) break;
      }
      const parts = [
        imported && `${imported} ta yangi SKU qo'shildi`,
        c.applied && `${c.applied} ta yangi yozuv`,
        c.cancelled && `${c.cancelled} ta bekor qilindi`,
        c.pending && `${c.pending} ta kutmoqda`,
      ].filter(Boolean);
      toast.show({ tone: 'ok', message: parts.length ? `Yangilandi: ${parts.join(', ')}` : "Yangilandi. Yangi o'zgarish yo'q." });
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
      status.reload();
    } finally {
      setSyncing(false);
    }
  }

  const events = attention.data?.events ?? [];
  const pending = events.filter((e) => e.status === 'pending');

  return (
    <>
      {s && (
        <section className="card sync-card">
          <div className="sync-card__text">
            <p className="sync-card__title">
              <span className={`dot ${s.lastError ? 'dot--error' : 'dot--ok'}`} aria-hidden="true" />
              {s.lastError ? 'Yangilashda muammo' : "Bog'langan"}
            </p>
            <p className="sync-card__meta">{s.lastSyncAt ? `Yangilandi ${timeAgo(s.lastSyncAt)}` : 'Hali yangilanmagan'}</p>
            {s.lastError && <p className="notice notice--error">{s.lastError}</p>}
          </div>
          <button type="button" className="btn btn--primary" onClick={sync} disabled={syncing || s.running}>
            <Icon name="sync" size={20} className={syncing ? 'spin' : undefined} />
            {syncing || s.running ? 'Yangilanmoqda…' : 'Hozir yangilash'}
          </button>
          <SyncFrom value={s.syncFrom} />
        </section>
      )}

      {pending.length > 0 && (
        <section aria-labelledby="pending-title">
          <h2 id="pending-title" className="section-title">
            Kutilmoqda — {pending.length} ta
          </h2>
          <p className="section-hint">Omborda yetarli emas. Qoldiq to'g'rilansa, o'zi yoziladi.</p>
          <ul className="list" role="list">
            {pending.map((e) => (
              <EventRow key={e.id} event={e} target={e.variantId ? lookup.get(e.variantId) : undefined} />
            ))}
          </ul>
        </section>
      )}

      {recent.data && recent.data.events.length > 0 && (
        <section aria-labelledby="recent-title">
          <h2 id="recent-title" className="section-title">
            Oxirgi yozuvlar
          </h2>
          <ul className="list" role="list">
            {recent.data.events.map((e) => (
              <EventRow key={e.id} event={e} target={e.variantId ? lookup.get(e.variantId) : undefined} />
            ))}
          </ul>
        </section>
      )}

    </>
  );
}

function SyncFrom({ value }: { value: string | null }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(value ?? '');
  if (!editing) {
    return (
      <button type="button" className="link-btn link-btn--plain sync-card__from" onClick={() => setEditing(true)}>
        Hisob boshlangan sana: {value ? formatDateLabel(value) : '—'}
      </button>
    );
  }
  return (
    <div className="sync-from">
      <p className="field-hint">
        Shu sanadan oldingi Uzum hujjatlari hisobga olinmaydi. Sanani oldinga surish — ilgari yozilganlarni o'chirmaydi; orqaga surish —
        eski hujjatlarni ham yozadi (boshlang'ich qoldiqni shunga qarab kiritgan bo'lsangiz, ikki marta hisoblanmasligiga e'tibor bering).
      </p>
      <div className="row-actions">
        <input type="date" className="input input--short" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={async () => {
            try {
              await api.uzumSetSyncFrom(date);
              toast.show({ tone: 'ok', message: "Sana saqlandi. Keyingi yangilashda hisobga olinadi." });
              setEditing(false);
            } catch (err) {
              toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
            }
          }}
        >
          Saqlash
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>
          Bekor
        </button>
      </div>
    </div>
  );
}

function EventRow({ event: e, target }: { event: UzumEvent; target: VariantRef | undefined }) {
  const name = target ? fullName(target.product, target.variant) : [e.productTitle, e.skuTitle].filter(Boolean).join(' · ');
  return (
    <li className={`move${e.status === 'cancelled' ? ' is-voided' : ''}`}>
      <span className={`move__icon move__icon--${e.kind}`}>
        <Icon name={e.kind} size={20} />
      </span>
      <div className="move__body">
        <div className="move__top">
          <span className="move__type">
            {KIND_LABEL[e.kind]}
            {e.kind === 'sold' && e.location === 'own' ? ' (FBS)' : ''}: {num(e.quantity)} ta
          </span>
          {e.status === 'cancelled' && <span className="badge badge--muted">Uzumda bekor qilingan</span>}
          {e.status === 'pending' && <span className="badge badge--warn">Kutilmoqda</span>}
        </div>
        {target ? (
          <Link to={`/mahsulotlar/${target.product.id}`} className="move__product">
            {name}
          </Link>
        ) : (
          <span className="move__product">{name}</span>
        )}
        <p className="move__note">
          {e.label} · {formatDateLabel(e.date)}
        </p>
        {e.reason && <p className="move__reason">{e.reason}</p>}
      </div>
    </li>
  );
}
