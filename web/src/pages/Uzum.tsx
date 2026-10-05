// Uzum Market bilan bog'lanish: holat, qo'lda yangilash, e'tibor talab qiladigan yozuvlar, SKU'larni bog'lash va import.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDateLabel, type UzumEvent, type UzumEventKind } from '../../../domain/index.ts';
import { api, type CatalogSku } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { variantLookup, type VariantRef } from '../components/MovementList.tsx';
import { VariantPicker } from '../components/ProductPicker.tsx';
import { useToast } from '../components/Toast.tsx';
import { ConfirmDialog, Empty, ErrorBox, SkeletonList } from '../components/ui.tsx';
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
          Loyiha papkasidagi <code>.env</code> fayliga yozing: <code>UZUM_API_KEY=kalitingiz</code>
        </li>
        <li>Serverni qayta ishga tushiring va shu sahifani yangilang.</li>
      </ol>
      <p className="field-hint">Kalitni hech kimga yubormang va chatga yozmang — u faqat sizning kompyuteringizdagi .env faylida turadi.</p>
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
  const catalog = useAsync(() => api.uzumCatalog(), []);
  const products = useAsync(() => api.products(true), []);
  const lookup = useMemo(() => variantLookup(products.data?.products ?? []), [products.data]);
  const [syncing, setSyncing] = useState(false);
  const [linking, setLinking] = useState<CatalogSku | null>(null);
  const [importAll, setImportAll] = useState(false);
  const s = status.data;

  async function sync() {
    setSyncing(true);
    try {
      const { report } = await api.uzumSync();
      const c = report.changes;
      const parts = [
        c.applied && `${c.applied} ta yangi yozuv`,
        c.cancelled && `${c.cancelled} ta bekor qilindi`,
        c.pending && `${c.pending} ta kutmoqda`,
        c.unmatched && `${c.unmatched} ta bog'lanmagan`,
        report.linked && `${report.linked} ta SKU bog'landi`,
      ].filter(Boolean);
      toast.show({ tone: 'ok', message: parts.length ? `Yangilandi: ${parts.join(', ')}` : "Yangilandi. Yangi o'zgarish yo'q." });
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
      status.reload();
    } finally {
      setSyncing(false);
    }
  }

  const unlinked = (catalog.data?.skus ?? []).filter((x) => x.variantId === null && !x.archived);
  const unlinkedGroups = useMemo(() => {
    const map = new Map<number, CatalogSku[]>();
    for (const x of unlinked) {
      const list = map.get(x.productId);
      if (list) list.push(x);
      else map.set(x.productId, [x]);
    }
    return [...map.entries()];
  }, [unlinked]);
  const events = attention.data?.events ?? [];
  const pending = events.filter((e) => e.status === 'pending');
  const unmatchedCount = events.filter((e) => e.status === 'unmatched').length;

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

      {catalog.error && <ErrorBox error={catalog.error} onRetry={catalog.reload} />}
      {catalog.data && catalog.data.skus.length === 0 && <p className="calm">Uzum katalogi hali olinmagan. "Hozir yangilash"ni bosing.</p>}
      {unlinked.length > 0 && (
      <section aria-labelledby="unlinked-title">
        <h2 id="unlinked-title" className="section-title">
          Ilovaga qo'shilmagan — {unlinked.length} ta
        </h2>
        {(
          <>
            <p className="section-hint">
              Import qiling yoki mavjud mahsulotga bog'lang{unmatchedCount ? ` · ${unmatchedCount} ta yozuv kutyapti` : ''}.
            </p>
            <button type="button" className="btn btn--primary btn--block" onClick={() => setImportAll(true)}>
              <Icon name="plus" size={20} />
              Hammasini import qilish
            </button>
            {unlinkedGroups.map(([productId, skus]) => (
              <UnlinkedGroup key={productId} productId={productId} skus={skus} onLink={setLinking} />
            ))}
          </>
        )}
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

      <LinkDialog sku={linking} onClose={() => setLinking(null)} />
      <ConfirmDialog
        open={importAll}
        title="Hammasini import qilaymi?"
        confirmLabel="Ha, import qilish"
        onClose={() => setImportAll(false)}
        onConfirm={async () => {
          const r = await api.uzumImport();
          setImportAll(false);
          toast.show({ tone: 'ok', message: `Import qilindi: ${r.products} ta kartochka, ${r.variants} ta variant` });
        }}
      >
        <p>
          {unlinkedGroups.length} ta kartochka variantlari bilan ilovaga qo'shiladi. Uzumdagi hozirgi qoldiq "Uzumda" bo'lib yoziladi.
          Omborimdagi sonni keyin "Sanab tuzatish" bilan kiritasiz.
        </p>
      </ConfirmDialog>
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

function UnlinkedGroup({ productId, skus, onLink }: { productId: number; skus: CatalogSku[]; onLink: (s: CatalogSku) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 3;
  const shown = expanded ? skus : skus.slice(0, PREVIEW);
  return (
    <div className="uzum-group">
      <div className="uzum-group__head">
        <h3 className="uzum-group__title">
          {skus[0]!.productTitle}
          <span className="uzum-group__count">{skus.length} ta variant</span>
        </h3>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.uzumImport([productId]);
              toast.show({ tone: 'ok', message: `Import qilindi: ${r.variants} ta variant` });
            } catch (err) {
              toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
              setBusy(false);
            }
          }}
        >
          {busy ? 'Kuting…' : 'Import qilish'}
        </button>
      </div>
      <ul className="list" role="list">
        {shown.map((x) => (
          <li key={x.skuId} className="uzum-sku">
            <span className="row__main">
              <span className="row__title">{x.characteristics || x.skuTitle}</span>
              <span className="row__meta">
                Artikul: {x.sellerSkuCode || x.article || x.skuTitle} · Uzumda {num(x.quantityActive)} ta
              </span>
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onLink(x)}>
              <Icon name="link" size={18} />
              Bog'lash
            </button>
          </li>
        ))}
      </ul>
      {skus.length > PREVIEW && (
        <button type="button" className="link-btn link-btn--plain uzum-group__more" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Yig'ish" : `Yana ${skus.length - PREVIEW} ta variantni ko'rsatish`}
        </button>
      )}
    </div>
  );
}

/** Uzum SKU'sini ilovadagi variantga bog'lash: qidiruv bilan variant tanlanadi. */
function LinkDialog({ sku, onClose }: { sku: CatalogSku | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const products = useAsync(() => api.products(), [sku?.skuId]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (sku && !d.open) {
      setError(null);
      d.showModal();
    }
    if (!sku && d.open) d.close();
  }, [sku]);

  return (
    <dialog ref={ref} className="dialog dialog--tall" onClose={onClose} onCancel={onClose} aria-labelledby="link-title">
      <div className="dialog__header">
        <h2 id="link-title" className="dialog__title">
          Qaysi variant?
        </h2>
        <button type="button" className="icon-btn" aria-label="Yopish" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {sku && (
        <p className="dialog__lead">
          Uzumda: <b>{sku.productTitle}</b>
          {sku.characteristics ? ` · ${sku.characteristics}` : ''} ({sku.sellerSkuCode || sku.article || sku.skuTitle})
        </p>
      )}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      {products.data && sku && (
        <VariantPicker
          products={products.data.products}
          highlight="uzum"
          createNext="/uzum"
          onPick={async (_p, v) => {
            try {
              await api.uzumLink(sku.skuId, v.id);
              toast.show({ tone: 'ok', message: "Bog'landi. Shu mahsulotning Uzum yozuvlari endi avtomatik yoziladi." });
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}
      {products.data && products.data.products.length === 0 && (
        <Empty title="Ilovada mahsulot yo'q">Bog'lash o'rniga "Import qilish"ni bosing.</Empty>
      )}
    </dialog>
  );
}
