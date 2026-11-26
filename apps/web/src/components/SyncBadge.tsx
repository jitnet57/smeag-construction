import { useEffect, useState } from 'react';
import { clearFailed, flushOutbox, getSyncStatus, subscribeSync } from '../offline';
import { useI18n } from '../i18n';

const USE_SUPABASE = import.meta.env.VITE_USE_SUPABASE === '1';

/** Header pill: offline state, queued changes, and rejected syncs. */
export default function SyncBadge() {
  const { t } = useI18n();
  const [s, setS] = useState(getSyncStatus);
  useEffect(() => subscribeSync(setS), []);

  if (!USE_SUPABASE) return null;

  const pill = 'rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap flex-shrink-0';
  return (
    <>
      {!s.online && (
        <span className={`${pill} bg-amber-100 text-amber-800`} title={t('sync.offlineHint')}>
          ⚠ {t('sync.offline')}
        </span>
      )}
      {s.syncing ? (
        <span className={`${pill} bg-blue-100 text-blue-800`}>⟳ {t('sync.syncing')}</span>
      ) : (
        s.pending > 0 && (
          <button
            onClick={() => void flushOutbox()}
            className={`${pill} bg-blue-100 text-blue-800`}
            title={t('sync.offlineHint')}
          >
            ⇡ {s.pending} {t('sync.pending')}
          </button>
        )
      )}
      {s.failed > 0 && (
        <button onClick={clearFailed} className={`${pill} bg-red-100 text-red-700`} title={t('sync.failedHint')}>
          ✕ {s.failed} {t('sync.failed')}
        </button>
      )}
    </>
  );
}
