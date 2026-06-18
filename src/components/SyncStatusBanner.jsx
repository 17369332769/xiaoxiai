export default function SyncStatusBanner({ syncError, isSyncing, retrySync }) {
  if (!syncError) {
    return null;
  }

  return (
    <div className="sync-status-banner glass-panel" role="status" aria-live="polite">
      <div className="sync-status-copy">
        <div className="sync-status-title">后端连接失败</div>
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
        {isSyncing ? '重试中...' : '重新连接'}
      </button>
    </div>
  );
}
