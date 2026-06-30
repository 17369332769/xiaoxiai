import { View } from '@tarojs/components';
import { useT } from '../i18n/index.js';

export default function SyncStatusBanner({ syncError, isSyncing, retrySync }) {
  const t = useT();
  if (!syncError) {
    return null;
  }

  return (
    <View className="sync-status-banner glass-panel" role="status" aria-live="polite">
      <View className="sync-status-copy">
        <View className="sync-status-title">{t('syncBanner.title')}</View>
        <View className="sync-status-message">
          {syncError}
        </View>
      </View>
      <View
        className={`btn-primary sync-status-action${isSyncing ? ' is-disabled' : ''}`}
        onClick={isSyncing ? undefined : retrySync}
      >
        {isSyncing ? t('common.retrying') : t('syncBanner.retry')}
      </View>
    </View>
  );
}
