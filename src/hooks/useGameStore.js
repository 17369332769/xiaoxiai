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
  createSimulatedRecentEvent,
  getOrCreateUserId,
  trimRecentEvents,
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
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
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
    if (!userId) return;

    const syncUser = async () => {
      setStateIfMounted(setIsSyncing, true);
      setStateIfMounted(setSyncError, '');
      const controller = createTrackedRequestController();

      try {
        const data = await postJson('/api/user/sync', { userId }, { signal: controller.signal });
        if (controller.signal.aborted || !isMounted()) {
          return;
        }

        applyUserSnapshot(data.user, userStateSetters);
        setChatHistory(data.chatHistory);
        setTasks(data.tasks);
        setHasCheckedInToday(Boolean(data.user.hasCheckedInToday));
        applyRelationshipProfile(data.relationship);
        resetFailureState();
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
  }, [userId, notify, createTrackedRequestController, releaseTrackedRequestController, setStateIfMounted, isMounted, userStateSetters, syncAttempt, applyRelationshipProfile, resetFailureState]);

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
