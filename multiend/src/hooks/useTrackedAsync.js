import { useCallback, useEffect, useRef } from 'react';

// Minimal AbortController-shaped controller. The web build used the global
// AbortController, but mini-program JS cores don't reliably provide one, and the
// Taro.request-based network adapter does not consume an AbortSignal anyway —
// these controllers exist purely so in-flight async work can guard against
// applying state after a teardown / identity switch (the `signal.aborted`
// checks in useGameStore). This shim preserves exactly that behavior on H5,
// mini-program, and App alike.
function createAbortController() {
  const signal = { aborted: false };
  return {
    signal,
    abort() {
      signal.aborted = true;
    },
  };
}

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
    const controller = createAbortController();
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
