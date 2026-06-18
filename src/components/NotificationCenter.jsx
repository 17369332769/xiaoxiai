export default function NotificationCenter({ notifications, dismissNotification }) {
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
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
