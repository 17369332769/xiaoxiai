import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FOOD_ITEMS,
  GIFT_ITEMS,
  TIPPING_TIERS,
  THEMES,
  DEFAULT_THEME_ID,
  STORIES,
} from '@shared/gameConfig';
import { useGameActions } from './useGameActions.js';
import { useRelationshipMemory } from './useRelationshipMemory.js';
import { useNotifications } from './useNotifications.js';
import { useTrackedAsync } from './useTrackedAsync.js';
import { isAbortError, postJson } from '../adapters/request.js';
import { createClientLogger } from '../utils/clientLogger.js';
import * as storage from '../adapters/storage.js';
import { createAudio } from '../adapters/audio.js';
import {
  applyUserSnapshot,
  buildSyncFailureMessage,
  getOrCreateUserId,
} from '../utils/gameStoreHelpers.js';
const logger = createClientLogger('game-store');

// Re-issue the auth token about twice a day so active sessions stay ahead of the
// token TTL (measured in days) and never expire out from under the user.
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

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
  // Whether the server requires an OTP code to register (drives the register form).
  const [requireRegistrationOtp, setRequireRegistrationOtp] = useState(false);
  // Cosmetic theme state (which themes the user owns + the equipped one).
  const [ownedThemes, setOwnedThemes] = useState([DEFAULT_THEME_ID]);
  const [equippedTheme, setEquippedTheme] = useState(DEFAULT_THEME_ID);
  // Story state: which 剧情 episodes the user has finished reading.
  const [readStories, setReadStories] = useState([]);
  // Which AI message is currently being voiced (TTS), so its 🔊 button can show
  // a playing state. null when nothing is speaking.
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const ttsAudioRef = useRef(null);
  const [authPending, setAuthPending] = useState(false);
  const authPendingRef = useRef(false);
  const [transactions, setTransactions] = useState([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const isLoadingTransactionsRef = useRef(false);
  const [orders, setOrders] = useState([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const isLoadingOrdersRef = useRef(false);
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
        const data = await postJson('/api/user/sync', { userId }, { signal: controller.signal, retries: 2 });
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
        setRequireRegistrationOtp(Boolean(data.requireRegistrationOtp));
        if (data.themes) {
          setOwnedThemes(Array.isArray(data.themes.owned) ? data.themes.owned : [DEFAULT_THEME_ID]);
          setEquippedTheme(data.themes.equipped || DEFAULT_THEME_ID);
        }
        if (data.stories) {
          setReadStories(Array.isArray(data.stories.read) ? data.stories.read : []);
        }
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
            storage.removeItem('xxa_token');
            const freshId = `user_${Math.random().toString(36).substring(2, 11)}_${Date.now().toString().slice(-4)}`;
            storage.setItem('xxa_user_id', freshId);
            setAccount({ bound: false, identifier: null });
            setEquippedTheme(DEFAULT_THEME_ID);
            setOwnedThemes([DEFAULT_THEME_ID]);
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
        const data = await postJson('/api/presence', { userId }, { retries: 1 });
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

  // ---- Recharge / order history (read-only; safe to retry on a flaky network) ----
  const loadOrders = useCallback(async () => {
    if (!userId || isSyncing || isLoadingOrdersRef.current) return false;
    isLoadingOrdersRef.current = true;
    setStateIfMounted(setIsLoadingOrders, true);
    try {
      const data = await postJson('/api/order/list', { userId }, { retries: 1 });
      if (!isMounted()) return false;
      setStateIfMounted(setOrders, Array.isArray(data.orders) ? data.orders : []);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to load orders', { error: err });
      notify(err.message, 'error', '订单加载失败');
      return false;
    } finally {
      isLoadingOrdersRef.current = false;
      setStateIfMounted(setIsLoadingOrders, false);
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
        try { storage.setItem('xxa_token', data.token); } catch { /* ignore */ }
      }
      if (data.account) {
        setAccount({ bound: true, identifier: data.account.identifier || null });
      }
      // Logging in on another device switches to the canonical account userId,
      // which re-triggers a full sync via the userId effect dependency.
      if (switchUserId && data.account?.userId) {
        try { storage.setItem('xxa_user_id', data.account.userId); } catch { /* ignore */ }
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

  const registerAccount = useCallback((identifier, password, code) => {
    return submitAuth('/api/auth/register', { userId, identifier, password, ...(code ? { code } : {}) });
  }, [submitAuth, userId]);

  const loginAccount = useCallback((identifier, password) => {
    return submitAuth('/api/auth/login', { identifier, password }, { switchUserId: true });
  }, [submitAuth]);

  // Request a verification code for registration / password reset. Returns the
  // response ({ ok, sent, devCode? }) or null on error (already notified).
  const requestAuthCode = useCallback(async (identifier, purpose) => {
    try {
      const data = await postJson('/api/auth/request-code', { identifier, purpose });
      if (!isMounted()) return null;
      return data;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return null;
      logger.error('Verification code request failed', { error: err });
      notify(err.message, 'error', '发送失败');
      return null;
    }
  }, [notify, isMounted]);

  // Reset a forgotten password with a code; on success the server logs us in
  // (returns a fresh token + the canonical userId), mirroring login.
  const resetPassword = useCallback(async (identifier, code, password) => {
    try {
      const data = await postJson('/api/auth/reset-password', { identifier, code, password });
      if (!isMounted()) return false;
      if (data.token) {
        try { storage.setItem('xxa_token', data.token); } catch { /* ignore */ }
      }
      if (data.account) {
        setAccount({ bound: true, identifier: data.account.identifier || null });
        if (data.account.userId) {
          try { storage.setItem('xxa_user_id', data.account.userId); } catch { /* ignore */ }
          setUserId(data.account.userId);
        }
      }
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Password reset failed', { error: err });
      notify(err.message, 'error', '重置失败');
      return false;
    }
  }, [notify, isMounted]);

  const logoutAccount = useCallback(() => {
    // Best-effort server-side revocation (bumps token_version so the token can't
    // be reused even if it leaked) before dropping the local token. Fire-and-
    // forget: the local logout below must succeed regardless.
    postJson('/api/auth/logout', {}).catch(() => { /* token already gone / offline */ });
    try {
      storage.removeItem('xxa_token');
      const freshId = `user_${Math.random().toString(36).substring(2, 11)}_${Date.now().toString().slice(-4)}`;
      storage.setItem('xxa_user_id', freshId);
      setAccount({ bound: false, identifier: null });
      setEquippedTheme(DEFAULT_THEME_ID);
      setOwnedThemes([DEFAULT_THEME_ID]);
      setUserId(freshId);
    } catch { /* ignore */ }
  }, []);

  // Silently extend a still-valid login by re-issuing the token at its current
  // version (does NOT revoke other sessions), so an active user is never logged
  // out mid-use. Best-effort: a guest (no token) no-ops, and a truly-expired
  // token is handled by the sync effect's 401 -> guest path.
  const refreshAuthToken = useCallback(async () => {
    let token = null;
    try { token = storage.getItem('xxa_token'); } catch { /* ignore */ }
    if (!token) return false;
    try {
      const data = await postJson('/api/auth/refresh', {});
      if (data?.token) {
        try { storage.setItem('xxa_token', data.token); } catch { /* ignore */ }
      }
      return true;
    } catch (err) {
      if (!isAbortError(err)) {
        logger.warn('Token refresh failed; keeping the existing token', { error: err });
      }
      return false;
    }
  }, []);

  // ---- Self-service data rights (privacy / compliance) ----
  // Export the full account payload; the caller turns it into a download. The
  // backend deliberately omits the password hash. Returns null on failure.
  const exportUserData = useCallback(async () => {
    if (!userId) return null;
    try {
      const data = await postJson('/api/user/export', { userId });
      if (!isMounted()) return null;
      return data.export || null;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return null;
      logger.error('Failed to export user data', { error: err });
      notify(err.message, 'error', '导出失败');
      return null;
    }
  }, [userId, notify, isMounted]);

  // Permanently delete the account + all data. Afterwards the current token is
  // dead, so reset to a brand-new guest (mirrors logout) to avoid a 401 loop.
  const deleteAccount = useCallback(async () => {
    if (!userId) return false;
    try {
      await postJson('/api/user/delete', { userId, confirm: true });
    } catch (err) {
      if (isAbortError(err)) return false;
      logger.error('Failed to delete account', { error: err });
      notify(err.message, 'error', '注销失败');
      return false;
    }
    if (!isMounted()) return true;
    try {
      storage.removeItem('xxa_token');
      const freshId = `user_${Math.random().toString(36).substring(2, 11)}_${Date.now().toString().slice(-4)}`;
      storage.setItem('xxa_user_id', freshId);
      setAccount({ bound: false, identifier: null });
      setEquippedTheme(DEFAULT_THEME_ID);
      setOwnedThemes([DEFAULT_THEME_ID]);
      setUserId(freshId);
    } catch { /* ignore */ }
    return true;
  }, [userId, notify, isMounted]);

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

  // User actively teaches Xiaoxi a fact ("让她记住 X"). `key` (topic) is optional.
  const addMemory = useCallback(async (text, key) => {
    if (!userId || !text?.trim()) return false;
    try {
      const data = await postJson('/api/memory/add', { userId, text: text.trim(), ...(key ? { key } : {}) });
      if (!isMounted()) return false;
      setMemories(Array.isArray(data.memories) ? data.memories : []);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to add memory', { error: err });
      notify(err.message, 'error', '记不下来');
      return false;
    }
  }, [userId, notify, isMounted]);

  // Edit an existing memory's content in place.
  const updateMemory = useCallback(async (key, text) => {
    if (!userId || !key || !text?.trim()) return false;
    try {
      const data = await postJson('/api/memory/update', { userId, key, text: text.trim() });
      if (!isMounted()) return false;
      setMemories(Array.isArray(data.memories) ? data.memories : []);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to update memory', { error: err });
      notify(err.message, 'error', '保存失败');
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

  // On-demand voice playback (RunningHub TTS) for a chat reply. Best-effort:
  // failures notify the user and never throw.
  const playVoice = useCallback(async (text, messageId = null) => {
    if (!userId || !text) return false;
    try {
      try { ttsAudioRef.current?.pause(); } catch { /* ignore */ }
      setStateIfMounted(setSpeakingMessageId, messageId);
      const data = await postJson('/api/tts', { userId, text });
      if (!isMounted()) return false;
      if (!data.audioUrl) {
        setStateIfMounted(setSpeakingMessageId, null);
        return false;
      }
      const audio = createAudio(data.audioUrl);
      ttsAudioRef.current = audio;
      const clearSpeaking = () => setStateIfMounted(setSpeakingMessageId, null);
      audio.onEnded(clearSpeaking);
      audio.onError(clearSpeaking);
      await audio.play();
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Voice playback failed', { error: err });
      const message = err.code === 'TTS_DISABLED'
        ? '语音功能还没配置好哦~'
        : '语音合成暂时不可用，稍后再试~';
      notify(message, 'warning', '语音');
      setStateIfMounted(setSpeakingMessageId, null);
      return false;
    }
  }, [userId, isMounted, setStateIfMounted, notify]);

  // Fire-and-forget UI behavior beacon (best-effort analytics; never throws).
  const track = useCallback((type, payload = {}) => {
    if (!userId) return;
    postJson('/api/analytics/track', { userId, type, payload }).catch(() => { /* non-critical */ });
  }, [userId]);

  // ---- Cosmetic themes (换装 / 主题换肤) ----
  const loadThemes = useCallback(async () => {
    if (!userId) return false;
    try {
      const data = await postJson('/api/themes', { userId });
      if (!isMounted()) return false;
      setOwnedThemes((prev) => (Array.isArray(data.owned) ? data.owned : prev));
      setEquippedTheme(data.equipped || DEFAULT_THEME_ID);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to load themes', { error: err });
      return false;
    }
  }, [userId, isMounted]);

  const unlockTheme = useCallback(async (themeId) => {
    if (!userId || !themeId) return false;
    try {
      const data = await postJson('/api/themes/unlock', { userId, themeId });
      if (!isMounted()) return false;
      if (typeof data.coins === 'number') setCoins(data.coins);
      setOwnedThemes((prev) => (Array.isArray(data.owned) ? data.owned : prev));
      setEquippedTheme(data.equipped || DEFAULT_THEME_ID);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to unlock theme', { error: err });
      notify(err.message, 'error', '解锁失败');
      return false;
    }
  }, [userId, notify, isMounted]);

  const equipTheme = useCallback(async (themeId) => {
    if (!userId || !themeId) return false;
    try {
      const data = await postJson('/api/themes/equip', { userId, themeId });
      if (!isMounted()) return false;
      setOwnedThemes((prev) => (Array.isArray(data.owned) ? data.owned : prev));
      setEquippedTheme(data.equipped || DEFAULT_THEME_ID);
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to equip theme', { error: err });
      notify(err.message, 'error', '切换失败');
      return false;
    }
  }, [userId, notify, isMounted]);

  // ---- Story episodes (剧情) ----
  const loadStories = useCallback(async () => {
    if (!userId) return false;
    try {
      const data = await postJson('/api/stories', { userId });
      if (!isMounted()) return false;
      setReadStories((prev) => (Array.isArray(data.read) ? data.read : prev));
      return true;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return false;
      logger.error('Failed to load stories', { error: err });
      return false;
    }
  }, [userId, isMounted]);

  // Mark an episode read (on finishing it), passing the player's choices. The backend
  // grants the one-time reward (coins + the affection earned from those choices) only
  // on the first completion; we apply the returned user snapshot (coins/affection/
  // level), append any level-up messages, refresh read state, and return the result
  // so the modal can announce the reward. Errors are notified.
  const claimStory = useCallback(async (storyId, choices) => {
    if (!userId || !storyId) return null;
    try {
      const data = await postJson('/api/stories/claim', { userId, storyId, choices });
      if (!isMounted()) return null;
      if (data.user) applyUserSnapshot(data.user, userStateSetters);
      if (Array.isArray(data.systemMessages) && data.systemMessages.length) {
        setChatHistory((prev) => [...prev, ...data.systemMessages]);
      }
      setReadStories((prev) => (Array.isArray(data.read) ? data.read : prev));
      return data;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return null;
      logger.error('Failed to claim story', { error: err });
      notify(err.message, 'error', '剧情读取失败');
      return null;
    }
  }, [userId, notify, isMounted, userStateSetters]);

  // Apply the equipped theme's palette to the document root whenever it changes.
  // Every theme defines the same CSS-variable keys, so equipping any theme
  // (including the default) fully overrides the previously applied one.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const theme = THEMES.find((t) => t.id === equippedTheme) || THEMES.find((t) => t.id === DEFAULT_THEME_ID);
    if (!theme) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.vars)) {
      root.style.setProperty(key, value);
    }
  }, [equippedTheme]);

  // Keep an authenticated session alive: refresh once the account is confirmed
  // bound (after sync / login) and periodically thereafter, so a long-lived tab
  // doesn't silently expire to a guest. Guests (bound === false) never refresh.
  useEffect(() => {
    if (!account.bound) return undefined;
    refreshAuthToken();
    const intervalId = setInterval(() => { refreshAuthToken(); }, TOKEN_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [account.bound, refreshAuthToken]);

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
    THEMES,
    STORIES,
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
    requireRegistrationOtp,
    requestAuthCode,
    resetPassword,
    exportUserData,
    deleteAccount,
    transactions,
    isLoadingTransactions,
    loadTransactions,
    orders,
    isLoadingOrders,
    loadOrders,
    memories,
    memorySummary,
    isLoadingMemories,
    loadMemories,
    deleteMemory,
    addMemory,
    updateMemory,
    clearMemories,
    ownedThemes,
    equippedTheme,
    loadThemes,
    unlockTheme,
    equipTheme,
    readStories,
    loadStories,
    claimStory,
    playVoice,
    speakingMessageId,
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
