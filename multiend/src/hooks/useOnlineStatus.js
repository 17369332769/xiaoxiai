import { useState, useEffect } from 'react';
import Taro from '@tarojs/taro';

// Cross-end network connectivity. The web build listened to window online/offline
// events + navigator.onLine; those globals don't exist on mini-program / App.
// Taro.getNetworkType + Taro.onNetworkStatusChange cover every end (on H5 they
// proxy the same browser events), so the offline banner behaves identically.
export function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;

    Taro.getNetworkType()
      .then((res) => {
        if (active) setOnline(res.networkType !== 'none');
      })
      .catch(() => {
        /* if the probe fails, optimistically assume online */
      });

    const handler = (res) => setOnline(Boolean(res.isConnected));
    Taro.onNetworkStatusChange(handler);

    return () => {
      active = false;
      // Newer base libraries require the same handler ref to detach.
      try {
        Taro.offNetworkStatusChange?.(handler);
      } catch {
        /* older bases auto-clean on page unload */
      }
    };
  }, []);

  return online;
}
