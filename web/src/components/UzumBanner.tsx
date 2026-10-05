// Bosh sahifada faqat e'tibor kerak bo'lganda ko'rinadi: Uzum bilan muammo yoki kutayotgan yozuvlar.
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { Icon } from './Icon.tsx';

export function UzumBanner() {
  const { data } = useAsync(() => api.uzumStatus(), []);
  if (!data?.configured || !data.shopLinked) return null;
  const attention = data.counts.pending + data.counts.unmatched;

  if (data.lastError) {
    return (
      <Link to="/uzum" className="banner banner--error">
        <Icon name="written_off" size={20} />
        <span>Uzum bilan bog'lanishda muammo</span>
        <Icon name="chevron" size={18} className="banner__chevron" />
      </Link>
    );
  }
  if (attention === 0) return null;
  return (
    <Link to="/uzum" className="banner banner--warn">
      <Icon name="uzum" size={20} />
      <span>
        Uzumdan <b>{attention} ta</b> yozuv kutyapti
      </span>
      <Icon name="chevron" size={18} className="banner__chevron" />
    </Link>
  );
}
