import { useCallback, useEffect, useRef, useState } from 'react';

export function useNotifications() {
  const notificationTimeoutsRef = useRef(new Map());
  const [notifications, setNotifications] = useState([]);

  const dismissNotification = useCallback((id) => {
    const timer = notificationTimeoutsRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      notificationTimeoutsRef.current.delete(id);
    }

    setNotifications((prev) => prev.filter((notification) => notification.id !== id));
  }, []);

  const notify = useCallback((message, type = 'info', title = '小希提示') => {
    const id = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextNotification = { id, title, message, type };

    setNotifications((prev) => [...prev, nextNotification]);

    const timer = setTimeout(() => {
      notificationTimeoutsRef.current.delete(id);
      setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    }, 3600);

    notificationTimeoutsRef.current.set(id, timer);
    return id;
  }, []);

  useEffect(() => {
    const notificationTimeouts = notificationTimeoutsRef.current;

    return () => {
      notificationTimeouts.forEach((timer) => clearTimeout(timer));
      notificationTimeouts.clear();
    };
  }, []);

  return {
    notifications,
    notify,
    dismissNotification,
  };
}
