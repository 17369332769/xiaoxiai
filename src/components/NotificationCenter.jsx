import { useT } from '../i18n/index.js';

export default function NotificationCenter({ notifications, dismissNotification }) {
  const t = useT();
  if (!notifications.length) {
    return null;
  }

  return (
    <div className="notification-stack" aria-live="polite" aria-atomic="true">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`notification-toast notification-${notification.type}`}
          role="status"
        >
          <div className="notification-copy">
            <div className="notification-title">{notification.title}</div>
            <div className="notification-message">{notification.message}</div>
          </div>
          <button
            type="button"
            className="notification-close"
            onClick={() => dismissNotification(notification.id)}
            aria-label={t('notif.closeAria')}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
