import { useCallback, useEffect, useRef } from 'react';

export function useTrackedAsync() {
  const isMountedRef = useRef(false);
  const requestControllersRef = useRef(new Set());

  const isMounted = useCallback(() => isMountedRef.current, []);

  const setStateIfMounted = useCallback((setter, valueOrUpdater) => {
    if (isMounted()) {
      setter(valueOrUpdater);
    }
  }, [isMounted]);

  const createTrackedRequestController = useCallback(() => {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    return controller;
  }, []);

  const releaseTrackedRequestController = useCallback((controller) => {
    requestControllersRef.current.delete(controller);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const requestControllers = requestControllersRef.current;

    return () => {
      isMountedRef.current = false;
      requestControllers.forEach((controller) => controller.abort());
      requestControllers.clear();
    };
  }, []);

  return {
    isMountedRef,
    isMounted,
    setStateIfMounted,
    createTrackedRequestController,
    releaseTrackedRequestController,
  };
}
