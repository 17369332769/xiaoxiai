import { View, Text } from '@tarojs/components';
import { useT } from '../i18n/index.js';

export default function NotificationCenter({ notifications, dismissNotification }) {
  const t = useT();
  if (!notifications.length) {
    return null;
  }

  return (
    <View className="notification-stack" aria-live="polite" aria-atomic="true">
      {notifications.map((notification) => (
        <View
          key={notification.id}
          className={`notification-toast notification-${notification.type}`}
          role="status"
        >
          <View className="notification-copy">
            <Text className="notification-title">{notification.title}</Text>
            <Text className="notification-message">{notification.message}</Text>
          </View>
          <View
            className="notification-close"
            onClick={() => dismissNotification(notification.id)}
            aria-label={t('notif.closeAria')}
          >
            ×
          </View>
        </View>
      ))}
    </View>
  );
}
