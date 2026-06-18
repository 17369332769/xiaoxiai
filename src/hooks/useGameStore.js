import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  FOOD_ITEMS,
  GIFT_ITEMS,
  TIPPING_TIERS,
} from '../../shared/gameConfig.js';
import { useNotifications } from './useNotifications.js';
import { useTrackedAsync } from './useTrackedAsync.js';
import { isAbortError, parseApiResponse } from '../utils/apiClient.js';
import { createClientLogger } from '../utils/clientLogger.js';
import {
  appendServerMessages,
  applyUserSnapshot,
  buildChatFailureMessage,
  buildSyncFailureMessage,
  createSimulatedRecentEvent,
  createTimestampedMessage,
  getOrCreateUserId,
  replaceTemporaryChatMessage,
  trimRecentEvents,
} from '../utils/gameStoreHelpers.js';
const logger = createClientLogger('game-store');

export function useGameStore() {
  const avatarResetTimeoutRef = useRef(null);
  const celebrationTimeoutRef = useRef(null);
  const { notifications, notify, dismissNotification } = useNotifications();
  const {
    isMounted,
    setStateIfMounted,
    createTrackedRequestController,
    releaseTrackedRequestController,
  } = useTrackedAsync();
  const [userId] = useState(() => {
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
  const [onlineCount, setOnlineCount] = useState(1314);
  const [recentEvents, setRecentEvents] = useState([
    '系统：欢迎来到 xiaoxiai.com！小希在这里等待着你的关爱~',
    '玩家「爱希一万年」刚刚给小希赠送了 水晶玫瑰 🌹！好感度暴增！',
  ]);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationType, setCelebrationType] = useState('hearts'); // hearts, roses, stars
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [isSyncing, setIsSyncing] = useState(true);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isTipping, setIsTipping] = useState(false);
  const [activePurchaseKey, setActivePurchaseKey] = useState(null);
  const [claimingTaskIds, setClaimingTaskIds] = useState([]);
  const [lastFailedMessage, setLastFailedMessage] = useState('');
  const [lastFailedAction, setLastFailedAction] = useState(null);
  const isSendingMessageRef = useRef(false);
  const isCheckingInRef = useRef(false);
  const isTippingRef = useRef(false);
  const activePurchaseKeyRef = useRef(null);
  const claimingTaskIdsRef = useRef(new Set());
  const [syncAttempt, setSyncAttempt] = useState(0);
  const userStateSetters = useMemo(() => ({
    setLevel,
    setAffection,
    setEnergy,
    setMood,
    setCoins,
  }), [setLevel, setAffection, setEnergy, setMood, setCoins]);

  const beginBooleanPending = useCallback((pendingRef, setPending) => {
    if (!isMounted() || pendingRef.current) {
      return false;
    }

    pendingRef.current = true;
    setStateIfMounted(setPending, true);
    return true;
  }, [isMounted, setStateIfMounted]);

  const endBooleanPending = useCallback((pendingRef, setPending) => {
    pendingRef.current = false;
    setStateIfMounted(setPending, false);
  }, [setStateIfMounted]);

  const beginPurchase = useCallback((purchaseKey) => {
    if (!isMounted() || activePurchaseKeyRef.current) {
      return false;
    }

    activePurchaseKeyRef.current = purchaseKey;
    setStateIfMounted(setActivePurchaseKey, purchaseKey);
    return true;
  }, [isMounted, setStateIfMounted]);

  const endPurchase = useCallback(() => {
    activePurchaseKeyRef.current = null;
    setStateIfMounted(setActivePurchaseKey, null);
  }, [setStateIfMounted]);

  const beginTaskClaim = useCallback((taskId) => {
    if (!isMounted() || claimingTaskIdsRef.current.has(taskId)) {
      return false;
    }

    claimingTaskIdsRef.current.add(taskId);
    setStateIfMounted(setClaimingTaskIds, Array.from(claimingTaskIdsRef.current));
    return true;
  }, [isMounted, setStateIfMounted]);

  const endTaskClaim = useCallback((taskId) => {
    claimingTaskIdsRef.current.delete(taskId);
    setStateIfMounted(setClaimingTaskIds, Array.from(claimingTaskIdsRef.current));
  }, [setStateIfMounted]);

  const scheduleCelebrationReset = useCallback((delayMs) => {
    if (celebrationTimeoutRef.current) {
      clearTimeout(celebrationTimeoutRef.current);
    }

    celebrationTimeoutRef.current = setTimeout(() => {
      celebrationTimeoutRef.current = null;
      setStateIfMounted(setShowCelebration, false);
    }, delayMs);
  }, [setStateIfMounted]);

  useEffect(() => {
    return () => {
      if (avatarResetTimeoutRef.current) {
        clearTimeout(avatarResetTimeoutRef.current);
        avatarResetTimeoutRef.current = null;
      }

      if (celebrationTimeoutRef.current) {
        clearTimeout(celebrationTimeoutRef.current);
        celebrationTimeoutRef.current = null;
      }
    };
  }, []);

  // Sync user state from backend Express endpoints on mount or userId set
  useEffect(() => {
    if (!userId) return;

    const syncUser = async () => {
      setStateIfMounted(setIsSyncing, true);
      setStateIfMounted(setSyncError, '');
      const controller = createTrackedRequestController();

      try {
        const response = await fetch('/api/user/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ userId }),
        });
        const data = await parseApiResponse(response);
        if (controller.signal.aborted || !isMounted()) {
          return;
        }

        applyUserSnapshot(data.user, userStateSetters);
        setChatHistory(data.chatHistory);
        setTasks(data.tasks);
        setHasCheckedInToday(Boolean(data.user.hasCheckedInToday));
        setStateIfMounted(setLastFailedMessage, '');
        setStateIfMounted(setLastFailedAction, null);
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
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
  }, [userId, notify, createTrackedRequestController, releaseTrackedRequestController, setStateIfMounted, isMounted, userStateSetters, syncAttempt]);

  const retrySync = useCallback(() => {
    if (isSyncing) {
      return;
    }

    setSyncAttempt((attempt) => attempt + 1);
  }, [isSyncing]);

  // Handle Online Count fluctuation (local visual sugar)
  useEffect(() => {
    const timer = setInterval(() => {
      setOnlineCount(prev => {
        const delta = Math.floor(Math.random() * 9) - 4; // -4 to +4
        return Math.max(1000, prev + delta);
      });
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  // Simulated ticker events (local visual sugar)
  useEffect(() => {
    const timer = setInterval(() => {
      const eventText = createSimulatedRecentEvent();
      setRecentEvents((prev) => trimRecentEvents(prev, eventText));
    }, 12000);
    return () => clearInterval(timer);
  }, []);

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

  // Send message action to backend
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || !userId || isSyncing) return false;
    if (!beginBooleanPending(isSendingMessageRef, setIsSendingMessage)) return false;

    const tempId = `user-temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 1. Optimistic UI update: append user message immediately
    const userMsg = {
      ...createTimestampedMessage(tempId, 'user', text),
    };
    setChatHistory(prev => [...prev, userMsg]);
    const controller = createTrackedRequestController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ userId, text }),
      });
      const data = await parseApiResponse(response);
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      // 2. Append real AI response & system updates returned from server
      setChatHistory((prev) => replaceTemporaryChatMessage(prev, tempId, data.aiMessage, data.systemMessages));

      // 3. Update character stats & tasks
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      setStateIfMounted(setLastFailedMessage, '');

      // Set avatar reaction
      setAvatarState(data.aiMessage.avatarState);
      return true;

    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Chat request failed', { error: err });
      notify(err.message, 'error', '发送失败');
      setStateIfMounted(setLastFailedMessage, text);
      // Fallback notification in logs if backend fails completely
      setChatHistory((prev) => [...prev.filter((msg) => msg.id !== tempId), buildChatFailureMessage()]);
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endBooleanPending(isSendingMessageRef, setIsSendingMessage);
    }
  }, [userId, notify, isSyncing, beginBooleanPending, endBooleanPending, createTrackedRequestController, releaseTrackedRequestController, isMounted, userStateSetters, setStateIfMounted]);

  const retryLastFailedMessage = useCallback(async () => {
    if (!lastFailedMessage || isSendingMessage || isSyncing) {
      return false;
    }

    return sendMessage(lastFailedMessage);
  }, [lastFailedMessage, isSendingMessage, isSyncing, sendMessage]);

  // Feed action to backend
  const feedXiaoxi = useCallback(async (foodId) => {
    const food = FOOD_ITEMS.find(f => f.id === foodId);
    if (!food || !userId || isSyncing) return false;

    if (coins < food.cost) {
      notify('爱心币不足哦，先去完成任务或者打赏补充一下吧。', 'warning', '余额不足');
      return false;
    }

    const purchaseKey = `food:${foodId}`;
    if (!beginPurchase(purchaseKey)) return false;
    const controller = createTrackedRequestController();

    try {
      const response = await fetch('/api/action/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          userId,
          foodId
        }),
      });
      const data = await parseApiResponse(response);
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      // Append chat log from server
      setChatHistory((prev) => appendServerMessages(prev, [data.sysMsg, data.aiMsg], data.systemMessages));

      // Update states
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      setStateIfMounted(setLastFailedAction, null);
      setAvatarState('happy');
      return true;

    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Feed request failed', { error: err });
      notify(err.message, 'error', '喂食失败');
      setStateIfMounted(setLastFailedAction, {
        kind: 'food',
        itemId: foodId,
        label: food.name,
      });
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endPurchase();
    }
  }, [userId, coins, notify, isSyncing, beginPurchase, endPurchase, createTrackedRequestController, releaseTrackedRequestController, isMounted, userStateSetters, setStateIfMounted]);

  // Gift action to backend
  const giftXiaoxi = useCallback(async (giftId) => {
    const gift = GIFT_ITEMS.find(g => g.id === giftId);
    if (!gift || !userId || isSyncing) return false;

    if (coins < gift.cost) {
      notify('爱心币不足哦，先去赚一点再来送礼吧。', 'warning', '余额不足');
      return false;
    }

    const purchaseKey = `gift:${giftId}`;
    if (!beginPurchase(purchaseKey)) return false;
    const controller = createTrackedRequestController();

    try {
      const response = await fetch('/api/action/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          userId,
          giftId
        }),
      });
      const data = await parseApiResponse(response);
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      // Append chat logs
      setChatHistory((prev) => appendServerMessages(prev, [data.sysMsg, data.aiMsg], data.systemMessages));

      // Trigger animation celebration
      setCelebrationType(giftId === 'ring' ? 'roses' : 'stars');
      setShowCelebration(true);
      scheduleCelebrationReset(3000);

      // Update stats
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      setStateIfMounted(setLastFailedAction, null);
      setAvatarState(giftId === 'ring' ? 'blush' : 'happy');
      return true;

    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Gift request failed', { error: err });
      notify(err.message, 'error', '送礼失败');
      setStateIfMounted(setLastFailedAction, {
        kind: 'gift',
        itemId: giftId,
        label: gift.name,
      });
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endPurchase();
    }
  }, [userId, coins, notify, isSyncing, beginPurchase, endPurchase, createTrackedRequestController, releaseTrackedRequestController, scheduleCelebrationReset, isMounted, userStateSetters, setStateIfMounted]);

  // Daily task claim reward to backend
  const claimTaskReward = useCallback(async (taskId) => {
    if (!userId || !taskId || isSyncing) return false;
    if (!beginTaskClaim(taskId)) return false;
    const controller = createTrackedRequestController();

    try {
      const response = await fetch('/api/task/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ userId, taskId }),
      });
      const data = await parseApiResponse(response);
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      setChatHistory(prev => [...prev, data.sysMsg]);
      setCoins(data.user.coins);
      setTasks(data.tasks);
      return true;

    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Task reward claim failed', { error: err });
      notify(err.message, 'error', '领奖失败');
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endTaskClaim(taskId);
    }
  }, [userId, notify, isSyncing, beginTaskClaim, endTaskClaim, createTrackedRequestController, releaseTrackedRequestController, isMounted]);

  // Daily check-in action to backend
  const dailyCheckIn = useCallback(async () => {
    if (!userId || isSyncing || hasCheckedInToday) return false;
    if (!beginBooleanPending(isCheckingInRef, setIsCheckingIn)) return false;
    const controller = createTrackedRequestController();

    try {
      const response = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ userId }),
      });
      const data = await parseApiResponse(response);
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      setChatHistory(prev => [...prev, data.aiMsg]);
      setTasks(data.tasks);
      setHasCheckedInToday(true);
      setAvatarState('happy');
      return true;

    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Check-in request failed', { error: err });
      if (err.code === 'ALREADY_CHECKED_IN') {
        notify('今天已经签过到啦，明天记得早点来见我哦。', 'info', '已完成签到');
        return false;
      }
      notify(err.message, 'error', '签到失败');
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endBooleanPending(isCheckingInRef, setIsCheckingIn);
    }
  }, [userId, notify, isSyncing, hasCheckedInToday, beginBooleanPending, endBooleanPending, createTrackedRequestController, releaseTrackedRequestController, isMounted]);

  // Tip real money (simulated) to backend
  const tipXiaoxi = useCallback(async (amount, paymentMethod) => {
    if (!userId || isSyncing) return false;
    if (!beginBooleanPending(isTippingRef, setIsTipping)) return false;
    const controller = createTrackedRequestController();

    try {
      const response = await fetch('/api/action/tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          userId,
          amount,
          paymentMethod
        }),
      });
      const data = await parseApiResponse(response);
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      // Add chat message
      setChatHistory(prev => {
        const updated = [...prev, data.sysMsg, data.aiMsg];
        if (data.systemMessages?.length) {
          updated.push(...data.systemMessages);
        }
        return updated;
      });

      // Trigger full screen rose petal shower
      setCelebrationType('roses');
      setShowCelebration(true);
      scheduleCelebrationReset(4000);

      // Broadcast marquee bulletin (local sync)
      const newBulletin = `公告：感谢亲爱的打赏 ¥${amount} 元！小希感动得要哭了，赠送了小希大量的爱心币！✨`;
      setRecentEvents((prev) => [newBulletin, ...prev]);

      // Update states
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      setStateIfMounted(setLastFailedAction, null);
      setAvatarState('blush');
      return true;

    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Tipping request failed', { error: err });
      notify(err.message, 'error', '打赏失败');
      setStateIfMounted(setLastFailedAction, {
        kind: 'tip',
        amount,
        paymentMethod,
        label: `¥${amount} / ${paymentMethod === 'wechat' ? '微信支付' : '支付宝'}`,
      });
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endBooleanPending(isTippingRef, setIsTipping);
    }
  }, [userId, notify, isSyncing, beginBooleanPending, endBooleanPending, createTrackedRequestController, releaseTrackedRequestController, scheduleCelebrationReset, isMounted, userStateSetters, setStateIfMounted]);

  const retryLastFailedAction = useCallback(async () => {
    if (!lastFailedAction || isSyncing || Boolean(activePurchaseKey) || isTipping) {
      return false;
    }

    if (lastFailedAction.kind === 'food') {
      return feedXiaoxi(lastFailedAction.itemId);
    }

    if (lastFailedAction.kind === 'gift') {
      return giftXiaoxi(lastFailedAction.itemId);
    }

    if (lastFailedAction.kind === 'tip') {
      return tipXiaoxi(lastFailedAction.amount, lastFailedAction.paymentMethod);
    }

    return false;
  }, [lastFailedAction, isSyncing, activePurchaseKey, isTipping, feedXiaoxi, giftXiaoxi, tipXiaoxi]);

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
    hasCheckedInToday,
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
