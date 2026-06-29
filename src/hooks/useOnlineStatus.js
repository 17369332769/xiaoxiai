import { useState, useEffect } from 'react';

// Tracks browser network connectivity (navigator.onLine + the online/offline
// events). Drives the offline banner so a dropped connection reads as "you're
// offline" rather than the misleading "backend is down" sync error.
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
