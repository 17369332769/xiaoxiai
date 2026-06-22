import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FOOD_ITEMS,
  GIFT_ITEMS,
  TIPPING_TIERS,
} from '../../shared/gameConfig.js';
import { useGameActions } from './useGameActions.js';
import { useRelationshipMemory } from './useRelationshipMemory.js';
import { useNotifications } from './useNotifications.js';
import { useTrackedAsync } from './useTrackedAsync.js';
import { isAbortError, postJson } from '../utils/apiClient.js';
import { createClientLogger } from '../utils/clientLogger.js';
import {
  applyUserSnapshot,
  buildSyncFailureMessage,
  getOrCreateUserId,
} from '../utils/gameStoreHelpers.js';
const logger = createClientLogger('game-store');

export function useGameStore() {
  const avatarResetTimeoutRef = useRef(null);
  const { notifications, notify, dismissNotification } = useNotifications();
  const {
    isMounted,
    setStateIfMounted,
    createTrackedRequestController,
    releaseTrackedRequestController,
  } = useTrackedAsync();
  // userId is stateful so logging in / out can switch the canonical id and
  // re-trigger the sync effect (cross-device account sync).
  const [userId, setUserId] = useState(() => {
    return getOrCreateUserId();
  });
  const [level, setLevel] = useState(1);
  const [affection, setAffection] = useState(10);
  const [energy, setEnergy] = useState(80);
  const [mood, setMood] = useState(70);
  const [coins, setCoins] = useState(200);
  const [avatarState, setAvatarState] = useState('normal'); // normal, happy, blush
  const [chatHistory, setChatHistory] = useState([]);
  const [tasks, setTasks] = useState([]);
  // Start at 1 (just this client); the presence poll replaces it with the real
  // count within ~2s. Avoid a fabricated "looks busy" seed.
  const [onlineCount, setOnlineCount] = useState(1);
  // Neutral placeholder shown until the real broadcast feed loads (~2s). Avoid
  // fabricated "player X gifted Y" lines — the ticker should only ever show real
  // event-driven broadcasts and operator announcements.
  const [recentEvents, setRecentEvents] = useState([
    '系统：欢迎来到 xiaoxiai.com！小希在这里等待着你的关爱~',
  ]);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [checkinStreak, setCheckinStreak] = useState(0);
  const [loginStreak, setLoginStreak] = useState(0);
  const [account, setAccount] = useState({ bound: false, identifier: null });
  // Whether the server allows the demo simulated-payment path (instant tip /
  // replayable callback). Off in production — drives ShopModal affordances.
  const [allowSimulatedPayment, setAllowSimulatedPayment] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const authPendingRef = useRef(false);
  const [transactions, setTransactions] = useState([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const isLoadingTransactionsRef = useRef(false);
  const [memories, setMemories] = useState([]);
  const [memorySummary, setMemorySummary] = useState('');
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const isLoadingMemoriesRef = useRef(false);
  const [syncError, setSyncError] = useState('');
  const [isSyncing, setIsSyncing] = useState(true);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const userStateSetters = useMemo(() => ({
    setLevel,
    setAffection,
    setEnergy,
    setMood,
    setCoins,
  }), [setLevel, setAffection, setEnergy, setMood, setCoins]);
  const appendChatMessage = useCallback((message) => {
    setChatHistory((prev) => [...prev, message]);
  }, []);
  // Re-trigger the canonical /api/user/sync effect so coins / balance / freshly
  // persisted system messages all refresh through one code path (used after a
  // real payment settles).
  const refreshUserState = useCallback(() => {
    setSyncAttempt((attempt) => attempt + 1);
  }, []);
  const {
    relationshipSummary,
    relationshipHighlights,
    relationshipRecentUpdates,
    hasFreshRelationshipUpdate,
    applyRelationshipProfile,
  } = useRelationshipMemory({
    notify,
    setStateIfMounted,
    appendChatMessage,
  });
  const {
    showCelebration,
    celebrationType,
    isSendingMessage,
    isCheckingIn,
    isTipping,
    activePurchaseKey,
    claimingTaskIds,
    lastFailedMessage,
    lastFailedAction,
    sendMessage,
    retryLastFailedMessage,
    feedXiaoxi,
    giftXiaoxi,
    claimTaskReward,
    dailyCheckIn,
    tipXiaoxi,
    createOrder,
    queryOrder,
    confirmPayment,
    retryLastFailedAction,
    resetFailureState,
  } = useGameActions({
    userId,
    coins,
    tasks,
    isSyncing,
    hasCheckedInToday,
    notify,
    isMounted,
    setStateIfMounted,
    createTrackedRequestController,
    releaseTrackedRequestController,
    userStateSetters,
    applyRelationshipProfile,
    setChatHistory,
    setTasks,
    setHasCheckedInToday,
    setAvatarState,
    setRecentEvents,
    refreshUserState,
  });

  useEffect(() => {
    return () => {
      if (avatarResetTimeoutRef.current) {
        clearTimeout(avatarResetTimeoutRef.current);
        avatarResetTimeoutRef.current = null;
      }
    };
  }, []);

  // Sync user state from backend Express endpoints on mount or userId set
  useEffect(() => {
    if (!userId) return undefined;

    const controller = createTrackedRequestController();
    const syncUser = async () => {
      setStateIfMounted(setIsSyncing, true);
      setStateIfMounted(setSyncError, '');

      try {
        const data = await postJson('/api/user/sync', { userId }, { signal: controller.signal });
        if (controller.signal.aborted || !isMounted()) {
          return;
        }

        applyUserSnapshot(data.user, userStateSetters);
        setChatHistory(data.chatHistory);
        setTasks(data.tasks);
        setHasCheckedInToday(Boolean(data.user.hasCheckedInToday));
        setCheckinStreak(data.user.checkinStreak || 0);
        setLoginStreak(data.user.loginStreak || 0);
        if (data.account) {
          setAccount({ bound: Boolean(data.account.bound), identifier: data.account.identifier || null });
        }
        setAllowSimulatedPayment(Boolean(data.allowSimulatedPayment));
        applyRelationshipProfile(data.relationship);
        resetFailureState();
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
          return;
        }

        // The bound account's token is missing/expired (e.g. after a secret
        // rotation or cleared storage): recover instead of looping on a
        // misleading "backend down" error. Drop the stale token and fall back to
        // a fresh guest so the app stays usable; logging in restores the account.
        if (err.code === 'AUTH_REQUIRED' || err.status === 401) {
          logger.warn('Sync rejected as unauthenticated; resetting to guest', { error: err });
          try {
            localStorage.removeItem('xxa_token');
            const freshId = `user_${Math.random().toString(36).substring(2, 11)}_${Date.now().toString().slice(-4)}`;
            localStorage.setItem('xxa_user_id', freshId);
            setAccount({ bound: false, identifier: null });
            notify('登录状态已失效，已切换为游客。重新登录即可恢复你的账号进度。', 'warning', '请重新登录');
            setUserId(freshId);
          } catch { /* ignore storage errors */ }
          return;
        }

        logger.error('Failed to sync user stats with backend', { error: err });
        notify('暂时连不上后端服务，请确认后端已经启动。', 'error', '连接失败');
        setStateIfMounted(setSyncError, '当前无法连接到后端服务。请确认后端已启动，然后点击“重新连接”。');
        setChatHistory([buildSyncFailureMessage()]);
      } finally {
        releaseTrackedRequestController(controller);
        setStateIfMounted(setIsSyncing, false);
      }
    };

    syncUser();

    // Abort an in-flight sync when userId changes (login/logout) so a stale
    // snapshot can't resolve late and clobber the new identity's state.
    return () => {
      controller.abort();
    };
  }, [userId, notify, createTrackedRequestController, releaseTrackedRequestController, setStateIfMounted, isMounted, userStateSetters, syncAttempt, applyRelationshipProfile, resetFailureState]);

  const retrySync = useCallback(() => {
    if (isSyncing) {
      return;
    }

    setSyncAttempt((attempt) => attempt + 1);
  }, [isSyncing]);

  // Real presence + broadcast feed. Polls the backend so the online count and
  // ticker reflect genuine activity (replacing the old random/local sugar). The
  // first poll is deferred (never fires synchronously) and the timers are cleared
  // on unmount / userId change.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await postJson('/api/presence', { userId });
        if (cancelled || !isMounted()) return;
        if (typeof data.onlineCount === 'number') {
          setStateIfMounted(setOnlineCount, data.onlineCount);
        }
        if (Array.isArray(data.broadcasts) && data.broadcasts.length) {
          setStateIfMounted(setRecentEvents, data.broadcasts.map((item) => item.text));
        }
      } catch {
        // Presence is best-effort visual data; keep the last known values.
      }
    };

    const initialTimer = setTimeout(poll, 2000);
    const interval = setInterval(poll, 25000);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [userId, isMounted, setStateIfMounted, setRecentEvents]);

  // Reset Avatar State back to normal after happy or blush
  useEffect(() => {
    if (avatarResetTimeoutRef.current) {
      clearTimeout(avatarResetTimeoutRef.current);
      avatarResetTimeoutRef.current = null;
    }

    if (avatarState !== 'normal') {
      avatarResetTimeoutRef.current = setTimeout(() => {
        avatarResetTimeoutRef.current = null;
        setStateIfMounted(setAvatarState, 'normal');
      }, 5000);

      return () => {
        if (avatarResetTimeoutRef.current) {
          clearTimeout(avatarResetTimeoutRef.current);
          avatarResetTimeoutRef.current = null;
        }
      };
    }
  }, [avatarState, setStateIfMounted]);

  // ---- Coin ledger / wallet history ----
  const loadTransactions = useCallback(async () => {
    if (!userId || isSyncing || isLoadingTransactionsRef.current) return false;
    isLoadingTransactionsRef.current = true;
    setStateIfMounted(setIsLoadingTransactions, true);
    try {
      const data = await postJson('/api/transactions', { userId });
      if (!isMounted()) return false;
      setStateIfMounted(setTransactions, Array.isArray(data.transactions) ? data.transactions : []);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to load transactions', { error: err });
      notify(err.message, 'error', '账单加载失败');
      return false;
    } finally {
      isLoadingTransactionsRef.current = false;
      setStateIfMounted(setIsLoadingTransactions, false);
    }
  }, [userId, isSyncing, notify, isMounted, setStateIfMounted]);

  // ---- Formal account system (register / login / bind / logout) ----
  const submitAuth = useCallback(async (endpoint, body, { switchUserId } = {}) => {
    if (authPendingRef.current) return false;
    authPendingRef.current = true;
    setStateIfMounted(setAuthPending, true);
    try {
      const data = await postJson(endpoint, body);
      if (!isMounted()) return false;

      if (data.token) {
        try { localStorage.setItem('xxa_token', data.token); } catch { /* ignore */ }
      }
      if (data.account) {
        setAccount({ bound: true, identifier: data.account.identifier || null });
      }
      // Logging in on another device switches to the canonical account userId,
      // which re-triggers a full sync via the userId effect dependency.
      if (switchUserId && data.account?.userId) {
        try { localStorage.setItem('xxa_user_id', data.account.userId); } catch { /* ignore */ }
        setUserId(data.account.userId);
      }
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Auth request failed', { endpoint, error: err });
      notify(err.message, 'error', '操作失败');
      return false;
    } finally {
      authPendingRef.current = false;
      setStateIfMounted(setAuthPending, false);
    }
  }, [isMounted, notify, setStateIfMounted]);

  const registerAccount = useCallback((identifier, password) => {
    return submitAuth('/api/auth/register', { userId, identifier, password });
  }, [submitAuth, userId]);

  const loginAccount = useCallback((identifier, password) => {
    return submitAuth('/api/auth/login', { identifier, password }, { switchUserId: true });
  }, [submitAuth]);

  const logoutAccount = useCallback(() => {
    try {
      localStorage.removeItem('xxa_token');
      const freshId = `user_${Math.random().toString(36).substring(2, 11)}_${Date.now().toString().slice(-4)}`;
      localStorage.setItem('xxa_user_id', freshId);
      setAccount({ bound: false, identifier: null });
      setUserId(freshId);
    } catch { /* ignore */ }
  }, []);

  // ---- Long-term memory management (user_memories CRUD) ----
  const loadMemories = useCallback(async () => {
    if (!userId || isLoadingMemoriesRef.current) return false;
    isLoadingMemoriesRef.current = true;
    setStateIfMounted(setIsLoadingMemories, true);
    try {
      const data = await postJson('/api/memory/list', { userId });
      if (!isMounted()) return false;
      setMemories(Array.isArray(data.memories) ? data.memories : []);
      setMemorySummary(data.summary || '');
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to load memories', { error: err });
      notify(err.message, 'error', '记忆加载失败');
      return false;
    } finally {
      isLoadingMemoriesRef.current = false;
      setStateIfMounted(setIsLoadingMemories, false);
    }
  }, [userId, notify, isMounted, setStateIfMounted]);

  const deleteMemory = useCallback(async (key) => {
    if (!userId || !key) return false;
    try {
      const data = await postJson('/api/memory/delete', { userId, key });
      if (!isMounted()) return false;
      setMemories(Array.isArray(data.memories) ? data.memories : []);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to delete memory', { error: err });
      notify(err.message, 'error', '删除失败');
      return false;
    }
  }, [userId, notify, isMounted]);

  const clearMemories = useCallback(async () => {
    if (!userId) return false;
    try {
      await postJson('/api/memory/clear', { userId });
      if (!isMounted()) return false;
      // The clear endpoint only returns a count; reflect the empty state locally.
      setMemories([]);
      setMemorySummary('');
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to clear memories', { error: err });
      notify(err.message, 'error', '清空失败');
      return false;
    }
  }, [userId, notify, isMounted]);

  // Fire-and-forget UI behavior beacon (best-effort analytics; never throws).
  const track = useCallback((type, payload = {}) => {
    if (!userId) return;
    postJson('/api/analytics/track', { userId, type, payload }).catch(() => { /* non-critical */ });
  }, [userId]);

  return {
    level,
    affection,
    energy,
    mood,
    coins,
    avatarState,
    chatHistory,
    tasks,
    onlineCount,
    recentEvents,
    relationshipSummary,
    relationshipHighlights,
    relationshipRecentUpdates,
    hasFreshRelationshipUpdate,
    showCelebration,
    celebrationType,
    FOOD_ITEMS,
    GIFT_ITEMS,
    TIPPING_TIERS,
    sendMessage,
    feedXiaoxi,
    giftXiaoxi,
    claimTaskReward,
    dailyCheckIn,
    tipXiaoxi,
    createOrder,
    queryOrder,
    confirmPayment,
    hasCheckedInToday,
    checkinStreak,
    loginStreak,
    account,
    allowSimulatedPayment,
    // True when an unbound guest has made progress worth warning about before a
    // login switches to another account's profile (A6).
    hasGuestProgress: !account.bound && (level > 1 || affection > 10 || coins !== 200),
    authPending,
    registerAccount,
    loginAccount,
    logoutAccount,
    transactions,
    isLoadingTransactions,
    loadTransactions,
    memories,
    memorySummary,
    isLoadingMemories,
    loadMemories,
    deleteMemory,
    clearMemories,
    track,
    syncError,
    retrySync,
    lastFailedMessage,
    retryLastFailedMessage,
    lastFailedAction,
    retryLastFailedAction,
    isSyncing,
    isSendingMessage,
    isCheckingIn,
    isTipping,
    activePurchaseKey,
    claimingTaskIds,
    notifications,
    notify,
    dismissNotification
  };
}
