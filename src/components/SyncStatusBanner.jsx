import { useT } from '../i18n/index.js';

export default function SyncStatusBanner({ syncError, isSyncing, retrySync }) {
  const t = useT();
  if (!syncError) {
    return null;
  }

  return (
    <div className="sync-status-banner glass-panel" role="status" aria-live="polite">
      <div className="sync-status-copy">
        <div className="sync-status-title">{t('syncBanner.title')}</div>
        <div className="sync-status-message">
          {syncError}
        </div>
      </div>
      <button
        type="button"
        className="btn-primary sync-status-action"
        onClick={retrySync}
        disabled={isSyncing}
      >
        {isSyncing ? t('common.retrying') : t('syncBanner.retry')}
      </button>
    </div>
  );
}
