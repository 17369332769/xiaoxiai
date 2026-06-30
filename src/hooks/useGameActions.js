import { useCallback, useEffect, useRef, useState } from 'react';
import { FOOD_ITEMS, GIFT_ITEMS } from '../../shared/gameConfig.js';
import { isAbortError, postJson, postSse } from '../utils/apiClient.js';
import { getStoredLang } from '../i18n/index.js';
import { createClientLogger } from '../utils/clientLogger.js';
import {
  applyUserSnapshot,
  appendServerMessages,
  buildChatFailureMessage,
  createTimestampedMessage,
} from '../utils/gameStoreHelpers.js';

const logger = createClientLogger('game-actions');

export function useGameActions({
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
}) {
  const celebrationTimeoutRef = useRef(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationType, setCelebrationType] = useState('hearts');
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
      if (celebrationTimeoutRef.current) {
        clearTimeout(celebrationTimeoutRef.current);
        celebrationTimeoutRef.current = null;
      }
    };
  }, []);

  const resetFailureState = useCallback(() => {
    setStateIfMounted(setLastFailedMessage, '');
    setStateIfMounted(setLastFailedAction, null);
  }, [setStateIfMounted]);

  // Streams the reply over SSE for a real (server-driven) typewriter. We insert
  // an empty AI placeholder, grow its text as `delta` frames arrive, then on the
  // `done` frame swap in the authoritative aiMessage (which may differ if output
  // safety replaced it) and apply the canonical user / tasks / relationship
  // snapshot. The non-streaming /api/chat endpoint stays as the server fallback.
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || !userId || isSyncing) {
      return false;
    }

    if (!beginBooleanPending(isSendingMessageRef, setIsSendingMessage)) {
      return false;
    }

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempUserId = `user-temp-${suffix}`;
    const tempAiId = `ai-temp-${suffix}`;
    const userMsg = createTimestampedMessage(tempUserId, 'user', text);
    const aiPlaceholder = createTimestampedMessage(tempAiId, 'ai', '', {
      avatarState: 'normal',
      streaming: true,
    });
    setChatHistory((prev) => [...prev, userMsg, aiPlaceholder]);
    const controller = createTrackedRequestController();

    let streamedText = '';
    let finalized = false;
    // Set only when the stream resolved/ended WITHOUT a complete `done` frame (a
    // truncated connection). Gates the non-streaming /api/chat fallback below: a
    // pre-stream connection reject or an authoritative `error` frame leaves this
    // false, so those still surface as failures rather than silently retrying.
    let streamTruncated = false;

    try {
      await postSse('/api/chat/stream', { userId, text, lang: getStoredLang() }, {
        signal: controller.signal,
        onEvent: (event, payload) => {
          if (event === 'delta') {
            streamedText += payload.text || '';
            if (!isMounted()) return;
            setChatHistory((prev) => prev.map((msg) => (
              msg.id === tempAiId ? { ...msg, text: streamedText } : msg
            )));
          } else if (event === 'reset') {
            // A tool round streamed a short lead-in before the skill call surfaced;
            // clear that preview so only the upcoming tool-grounded answer shows.
            streamedText = '';
            if (!isMounted()) return;
            setChatHistory((prev) => prev.map((msg) => (
              msg.id === tempAiId ? { ...msg, text: '' } : msg
            )));
          } else if (event === 'done') {
            if (!isMounted()) return;
            const aiMessage = payload.aiMessage;
            if (!aiMessage) {
              // A malformed/truncated `done` frame parses to `{}` upstream — bail
              // before mutating history so the catch can fall back / clean up.
              streamTruncated = true;
              throw new Error('回复没有收完，请稍后再试。');
            }
            // Mark finalized before the post-commit side effects so a later
            // snapshot / injected-callback error can't retroactively turn a
            // delivered reply into a failure (the catch returns success then).
            finalized = true;
            const finalAiMessage = { ...aiMessage, streamed: true };
            setChatHistory((prev) => {
              const next = prev
                .filter((msg) => msg.id !== tempAiId)
                .map((msg) => (msg.id === tempUserId
                  ? { ...msg, id: `user-${suffix}` }
                  : msg));
              next.push(finalAiMessage);
              if (payload.systemMessages?.length) {
                next.push(...payload.systemMessages);
              }
              return next;
            });
            applyUserSnapshot(payload.user, userStateSetters);
            setTasks(payload.tasks);
            if (payload.relationship) {
              applyRelationshipProfile(payload.relationship, { announce: true });
            }
            resetFailureState();
            setAvatarState(aiMessage.avatarState);
          } else if (event === 'error') {
            throw new Error(payload.message || '生成回复时出错了，请稍后再试。');
          }
        },
      });

      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      if (!finalized) {
        // Stream ended without a `done` frame (truncated connection) — fall back
        // to the non-streaming /api/chat below rather than failing outright.
        streamTruncated = true;
        throw new Error('回复没有收完，请稍后再试。');
      }

      return true;
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      if (finalized) {
        // The authoritative reply was already committed; a later side-effect
        // error must not append a failure bubble over a delivered reply.
        logger.error('Chat stream post-finalize step failed', { error: err });
        return true;
      }

      let failure = err;
      if (streamTruncated) {
        // The stream dropped mid-reply without a complete `done` frame. Fall back
        // once to the non-streaming /api/chat so the user still gets a reply. The
        // response carries the same shape as the `done` payload, so commit it the
        // same way (drop the streaming placeholder, promote the user temp message).
        try {
          const data = await postJson('/api/chat', { userId, text, lang: getStoredLang() }, { signal: controller.signal });
          if (controller.signal.aborted || !isMounted()) {
            return false;
          }
          if (!data.aiMessage) {
            throw new Error('回复没有收完，请稍后再试。', { cause: err });
          }
          const fallbackAiMessage = { ...data.aiMessage, streamed: true };
          setChatHistory((prev) => {
            const next = prev
              .filter((msg) => msg.id !== tempAiId)
              .map((msg) => (msg.id === tempUserId ? { ...msg, id: `user-${suffix}` } : msg));
            next.push(fallbackAiMessage);
            if (data.systemMessages?.length) {
              next.push(...data.systemMessages);
            }
            return next;
          });
          applyUserSnapshot(data.user, userStateSetters);
          setTasks(data.tasks);
          if (data.relationship) {
            applyRelationshipProfile(data.relationship, { announce: true });
          }
          resetFailureState();
          setAvatarState(data.aiMessage.avatarState);
          return true;
        } catch (fallbackErr) {
          if (controller.signal.aborted || isAbortError(fallbackErr) || !isMounted()) {
            return false;
          }
          // Both transports failed — fall through to the shared failure handling
          // using the fallback's error message.
          logger.error('Chat /api/chat fallback failed', { error: fallbackErr });
          failure = fallbackErr;
        }
      }

      logger.error('Chat stream failed', { error: failure });
      notify(failure.message, 'error', '发送失败');
      setStateIfMounted(setLastFailedMessage, text);
      setChatHistory((prev) => [
        ...prev.filter((msg) => msg.id !== tempUserId && msg.id !== tempAiId),
        buildChatFailureMessage(),
      ]);
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endBooleanPending(isSendingMessageRef, setIsSendingMessage);
    }
  }, [
    userId,
    isSyncing,
    beginBooleanPending,
    createTrackedRequestController,
    releaseTrackedRequestController,
    isMounted,
    setChatHistory,
    userStateSetters,
    setTasks,
    applyRelationshipProfile,
    setStateIfMounted,
    setAvatarState,
    notify,
    endBooleanPending,
    resetFailureState,
  ]);

  const retryLastFailedMessage = useCallback(async () => {
    if (!lastFailedMessage || isSendingMessage || isSyncing) {
      return false;
    }

    return sendMessage(lastFailedMessage);
  }, [lastFailedMessage, isSendingMessage, isSyncing, sendMessage]);

  const feedXiaoxi = useCallback(async (foodId) => {
    const food = FOOD_ITEMS.find((item) => item.id === foodId);
    if (!food || !userId || isSyncing) {
      return false;
    }

    if (coins < food.cost) {
      notify('爱心币不足哦，先去完成任务或者打赏补充一下吧。', 'warning', '余额不足');
      return false;
    }

    const purchaseKey = `food:${foodId}`;
    if (!beginPurchase(purchaseKey)) {
      return false;
    }

    const controller = createTrackedRequestController();

    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const data = await postJson('/api/action/feed', { userId, foodId, requestId }, { signal: controller.signal });
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      if (data.duplicate) {
        // A transport-level retry of this exact request was deduped server-side;
        // apply the authoritative state without re-appending messages.
        if (data.user) applyUserSnapshot(data.user, userStateSetters);
        if (data.tasks) setTasks(data.tasks);
        resetFailureState();
        return true;
      }

      setChatHistory((prev) => appendServerMessages(prev, [data.sysMsg, data.aiMsg], data.systemMessages));
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      resetFailureState();
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
  }, [
    userId,
    isSyncing,
    coins,
    notify,
    beginPurchase,
    createTrackedRequestController,
    isMounted,
    setChatHistory,
    userStateSetters,
    setTasks,
    setStateIfMounted,
    setAvatarState,
    releaseTrackedRequestController,
    endPurchase,
    resetFailureState,
  ]);

  const giftXiaoxi = useCallback(async (giftId) => {
    const gift = GIFT_ITEMS.find((item) => item.id === giftId);
    if (!gift || !userId || isSyncing) {
      return false;
    }

    if (coins < gift.cost) {
      notify('爱心币不足哦，先去赚一点再来送礼吧。', 'warning', '余额不足');
      return false;
    }

    const purchaseKey = `gift:${giftId}`;
    if (!beginPurchase(purchaseKey)) {
      return false;
    }

    const controller = createTrackedRequestController();

    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const data = await postJson('/api/action/gift', { userId, giftId, requestId }, { signal: controller.signal });
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      if (data.duplicate) {
        // Deduped retry: apply authoritative state, skip messages + celebration.
        if (data.user) applyUserSnapshot(data.user, userStateSetters);
        if (data.tasks) setTasks(data.tasks);
        resetFailureState();
        return true;
      }

      setChatHistory((prev) => appendServerMessages(prev, [data.sysMsg, data.aiMsg], data.systemMessages));
      setCelebrationType(giftId === 'ring' ? 'roses' : 'stars');
      setShowCelebration(true);
      scheduleCelebrationReset(3000);
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      resetFailureState();
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
  }, [
    userId,
    isSyncing,
    coins,
    notify,
    beginPurchase,
    createTrackedRequestController,
    isMounted,
    setChatHistory,
    scheduleCelebrationReset,
    userStateSetters,
    setTasks,
    setStateIfMounted,
    setAvatarState,
    releaseTrackedRequestController,
    endPurchase,
    resetFailureState,
  ]);

  const claimTaskReward = useCallback(async (taskId) => {
    if (!userId || !taskId || isSyncing) {
      return false;
    }

    const task = tasks.find((currentTask) => currentTask.id === taskId);
    if (!beginTaskClaim(taskId)) {
      return false;
    }

    const controller = createTrackedRequestController();

    try {
      const data = await postJson('/api/task/claim', { userId, taskId }, { signal: controller.signal });
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      setChatHistory((prev) => [...prev, data.sysMsg]);
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      resetFailureState();
      return true;
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Task reward claim failed', { error: err });
      if (err.code === 'TASK_NOT_CLAIMABLE') {
        setStateIfMounted(setLastFailedAction, null);
      } else {
        setStateIfMounted(setLastFailedAction, {
          kind: 'task-claim',
          taskId,
          label: task?.name || '任务奖励',
        });
      }
      notify(err.message, 'error', '领奖失败');
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endTaskClaim(taskId);
    }
  }, [
    userId,
    tasks,
    isSyncing,
    beginTaskClaim,
    createTrackedRequestController,
    isMounted,
    setChatHistory,
    userStateSetters,
    setTasks,
    setStateIfMounted,
    notify,
    releaseTrackedRequestController,
    endTaskClaim,
    resetFailureState,
  ]);

  const dailyCheckIn = useCallback(async () => {
    if (!userId || isSyncing || hasCheckedInToday) {
      return false;
    }

    if (!beginBooleanPending(isCheckingInRef, setIsCheckingIn)) {
      return false;
    }

    const controller = createTrackedRequestController();

    try {
      const data = await postJson('/api/checkin', { userId }, { signal: controller.signal });
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      setChatHistory((prev) => [...prev, data.aiMsg]);
      setTasks(data.tasks);
      setHasCheckedInToday(true);
      resetFailureState();
      setAvatarState('happy');
      return true;
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err) || !isMounted()) {
        return false;
      }

      logger.error('Check-in request failed', { error: err });
      if (err.code === 'ALREADY_CHECKED_IN') {
        setStateIfMounted(setLastFailedAction, null);
        notify('今天已经签过到啦，明天记得早点来见我哦。', 'info', '已完成签到');
        return false;
      }
      setStateIfMounted(setLastFailedAction, {
        kind: 'checkin',
        label: '每日签到',
      });
      notify(err.message, 'error', '签到失败');
      return false;
    } finally {
      releaseTrackedRequestController(controller);
      endBooleanPending(isCheckingInRef, setIsCheckingIn);
    }
  }, [
    userId,
    isSyncing,
    hasCheckedInToday,
    beginBooleanPending,
    createTrackedRequestController,
    isMounted,
    setChatHistory,
    setTasks,
    setHasCheckedInToday,
    setStateIfMounted,
    setAvatarState,
    notify,
    releaseTrackedRequestController,
    endBooleanPending,
    resetFailureState,
  ]);

  const tipXiaoxi = useCallback(async (amount, paymentMethod) => {
    if (!userId || isSyncing) {
      return false;
    }

    if (!beginBooleanPending(isTippingRef, setIsTipping)) {
      return false;
    }

    const controller = createTrackedRequestController();

    try {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const data = await postJson('/api/action/tip', {
        userId,
        amount,
        paymentMethod,
        requestId,
      }, { signal: controller.signal });
      if (controller.signal.aborted || !isMounted()) {
        return false;
      }

      if (data.duplicate) {
        // Deduped retry: apply authoritative state, skip messages + celebration.
        if (data.user) applyUserSnapshot(data.user, userStateSetters);
        if (data.tasks) setTasks(data.tasks);
        resetFailureState();
        return true;
      }

      setChatHistory((prev) => {
        const updated = [...prev, data.sysMsg, data.aiMsg];
        if (data.systemMessages?.length) {
          updated.push(...data.systemMessages);
        }
        return updated;
      });
      setCelebrationType('roses');
      setShowCelebration(true);
      scheduleCelebrationReset(4000);
      setRecentEvents((prev) => [
        `公告：感谢亲爱的打赏 ¥${amount} 元！小希感动得要哭了，赠送了小希大量的爱心币！✨`,
        ...prev,
      ]);
      applyUserSnapshot(data.user, userStateSetters);
      setTasks(data.tasks);
      resetFailureState();
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
  }, [
    userId,
    isSyncing,
    beginBooleanPending,
    createTrackedRequestController,
    isMounted,
    setChatHistory,
    scheduleCelebrationReset,
    setRecentEvents,
    userStateSetters,
    setTasks,
    setStateIfMounted,
    setAvatarState,
    notify,
    releaseTrackedRequestController,
    endBooleanPending,
    resetFailureState,
  ]);

  // ---- Real payment order link (scan-to-pay closed loop) ----
  // These thin wrappers expose the backend's true order endpoints so the UI can
  // orchestrate a create -> poll -> gateway-callback flow that mirrors a real
  // WeChat/Alipay scan payment. They return the parsed payload (or null on
  // failure) and never throw, so the calling component can drive its own state
  // machine without try/catch.
  const createOrder = useCallback(async (amount, paymentMethod) => {
    if (!userId || isSyncing) {
      return null;
    }

    try {
      const data = await postJson('/api/order/create', { userId, amount, paymentMethod });
      if (!isMounted()) return null;
      return data;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return null;
      logger.error('Order create failed', { error: err });
      notify(err.message, 'error', '下单失败');
      return null;
    }
  }, [userId, isSyncing, isMounted, notify]);

  const queryOrder = useCallback(async (orderRef) => {
    if (!userId || !orderRef) {
      return null;
    }

    const payload = orderRef.orderId
      ? { userId, orderId: orderRef.orderId }
      : { userId, outTradeNo: orderRef.outTradeNo };

    try {
      const data = await postJson('/api/order/query', payload);
      if (!isMounted()) return null;
      return data.order || null;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return null;
      logger.error('Order query failed', { error: err });
      return null;
    }
  }, [userId, isMounted]);

  // Replays the (pre-signed) gateway callback to settle the order. The backend
  // guarantees idempotency, so repeated confirmations are safe. On success we
  // refresh the full user snapshot so coins / balance / the recharge system
  // message all flow in through the canonical sync path.
  const confirmPayment = useCallback(async (callbackPayload) => {
    if (!callbackPayload) {
      return null;
    }

    try {
      const data = await postJson('/api/payment/callback', callbackPayload);
      if (!isMounted()) return null;

      if (data.settled || data.alreadyPaid) {
        setCelebrationType('roses');
        setShowCelebration(true);
        scheduleCelebrationReset(4000);
        setAvatarState('blush');
        if (typeof refreshUserState === 'function') {
          refreshUserState();
        }
      }
      return data;
    } catch (err) {
      if (isAbortError(err) || !isMounted()) return null;
      logger.error('Payment callback failed', { error: err });
      notify(err.message, 'error', '支付确认失败');
      return null;
    }
  }, [
    isMounted,
    notify,
    scheduleCelebrationReset,
    setAvatarState,
    refreshUserState,
  ]);

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

    if (lastFailedAction.kind === 'checkin') {
      return dailyCheckIn();
    }

    if (lastFailedAction.kind === 'task-claim') {
      return claimTaskReward(lastFailedAction.taskId);
    }

    return false;
  }, [
    lastFailedAction,
    isSyncing,
    activePurchaseKey,
    isTipping,
    feedXiaoxi,
    giftXiaoxi,
    tipXiaoxi,
    dailyCheckIn,
    claimTaskReward,
  ]);

  return {
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
  };
}
