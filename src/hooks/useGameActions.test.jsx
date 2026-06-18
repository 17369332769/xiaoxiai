import { useMemo, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useTrackedAsync } from './useTrackedAsync.js';
import { useGameActions } from './useGameActions.js';

function mockJsonResponse(payload, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => payload,
  });
}

function useGameActionsHarness({
  userId = 'test_user_actions',
  coins = 200,
  tasks: initialTasks = [],
  hasCheckedInToday: initialHasCheckedInToday = false,
  notify = vi.fn(),
  applyRelationshipProfile = vi.fn(),
} = {}) {
  const { isMounted, setStateIfMounted, createTrackedRequestController, releaseTrackedRequestController } = useTrackedAsync();
  const [level, setLevel] = useState(1);
  const [affection, setAffection] = useState(10);
  const [energy, setEnergy] = useState(80);
  const [mood, setMood] = useState(70);
  const [avatarState, setAvatarState] = useState('normal');
  const [chatHistory, setChatHistory] = useState([]);
  const [tasks, setTasks] = useState(initialTasks);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(initialHasCheckedInToday);
  const [recentEvents, setRecentEvents] = useState([]);
  const userStateSetters = useMemo(() => ({
    setLevel,
    setAffection,
    setEnergy,
    setMood,
    setCoins: () => {},
  }), []);

  const actions = useGameActions({
    userId,
    coins,
    tasks,
    isSyncing: false,
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

  return {
    ...actions,
    level,
    affection,
    energy,
    mood,
    avatarState,
    chatHistory,
    tasks,
    hasCheckedInToday,
    recentEvents,
  };
}

describe('useGameActions', () => {
  test('sendMessage appends AI reply and updates action-owned state', async () => {
    const applyRelationshipProfile = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/chat') {
        return mockJsonResponse({
          ok: true,
          aiMessage: {
            id: 'ai-action-1',
            sender: 'ai',
            text: '小希记住啦~',
            avatarState: 'happy',
            timestamp: '10:11',
          },
          user: {
            level: 2,
            affection: 18,
            energy: 78,
            mood: 76,
            coins: 200,
          },
          tasks: [
            { id: 'chat_3', name: '聊天 3 次', reward: 30, progress: 1, target: 3, completed: false, claimed: false },
          ],
          systemMessages: [
            { id: 'sys-action-1', sender: 'system', text: '升级啦', timestamp: '10:11' },
          ],
          relationship: {
            summary: '小希记住你喜欢喝拿铁。',
            highlights: [],
            recentUpdates: [],
          },
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameActionsHarness({ applyRelationshipProfile }));

    await act(async () => {
      const success = await result.current.sendMessage('请记住我喜欢拿铁');
      expect(success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.chatHistory.some((item) => item.id === 'ai-action-1')).toBe(true);
    });

    expect(result.current.level).toBe(2);
    expect(result.current.affection).toBe(18);
    expect(result.current.avatarState).toBe('happy');
    expect(result.current.tasks[0].id).toBe('chat_3');
    expect(result.current.chatHistory.some((item) => item.text === '升级啦')).toBe(true);
    expect(applyRelationshipProfile).toHaveBeenCalledWith(expect.objectContaining({
      summary: '小希记住你喜欢喝拿铁。',
    }), { announce: true });
  });

  test('stores failed chat text and retries it successfully', async () => {
    let chatCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/chat') {
        chatCalls += 1;

        if (chatCalls === 1) {
          return Promise.reject(new Error('temporary failure'));
        }

        return mockJsonResponse({
          ok: true,
          aiMessage: {
            id: 'ai-action-retry-1',
            sender: 'ai',
            text: '这次收到啦',
            avatarState: 'happy',
            timestamp: '10:12',
          },
          user: {
            level: 1,
            affection: 15,
            energy: 78,
            mood: 75,
            coins: 200,
          },
          tasks: [],
          systemMessages: [],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const notify = vi.fn();
    const { result } = renderHook(() => useGameActionsHarness({ notify }));

    await act(async () => {
      const success = await result.current.sendMessage('亲爱的你在吗');
      expect(success).toBe(false);
    });

    expect(result.current.lastFailedMessage).toBe('亲爱的你在吗');
    expect(notify).toHaveBeenCalledWith('temporary failure', 'error', '发送失败');

    await act(async () => {
      const success = await result.current.retryLastFailedMessage();
      expect(success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.chatHistory.some((item) => item.id === 'ai-action-retry-1')).toBe(true);
    });

    expect(chatCalls).toBe(2);
    expect(result.current.lastFailedMessage).toBe('');
  });

  test('dailyCheckIn stores a failed action and retryLastFailedAction can recover it', async () => {
    let checkinCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/checkin') {
        checkinCalls += 1;

        if (checkinCalls === 1) {
          return Promise.reject(new Error('checkin failed once'));
        }

        return mockJsonResponse({
          ok: true,
          aiMsg: {
            id: 'checkin-action-1',
            sender: 'ai',
            text: '签到成功',
            avatarState: 'happy',
            timestamp: '10:13',
          },
          tasks: [
            { id: 'checkin', name: '每日签到', reward: 50, progress: 1, target: 1, completed: true, claimed: false },
          ],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const notify = vi.fn();
    const { result } = renderHook(() => useGameActionsHarness({
      notify,
      tasks: [
        { id: 'checkin', name: '每日签到', reward: 50, progress: 0, target: 1, completed: false, claimed: false },
      ],
    }));

    await act(async () => {
      const success = await result.current.dailyCheckIn();
      expect(success).toBe(false);
    });

    expect(result.current.lastFailedAction).toEqual({
      kind: 'checkin',
      label: '每日签到',
    });

    await act(async () => {
      const success = await result.current.retryLastFailedAction();
      expect(success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.hasCheckedInToday).toBe(true);
    });

    expect(checkinCalls).toBe(2);
    expect(result.current.avatarState).toBe('happy');
    expect(result.current.lastFailedAction).toBe(null);
    expect(result.current.chatHistory.some((item) => item.id === 'checkin-action-1')).toBe(true);
  });

  test('giftXiaoxi triggers celebration state after a successful gift response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/action/gift') {
        return mockJsonResponse({
          ok: true,
          sysMsg: {
            id: 'gift-sys-1',
            sender: 'system',
            text: '送礼成功',
            timestamp: '10:14',
          },
          aiMsg: {
            id: 'gift-ai-1',
            sender: 'ai',
            text: '小希超喜欢这份礼物',
            avatarState: 'blush',
            timestamp: '10:14',
          },
          user: {
            level: 2,
            affection: 40,
            energy: 80,
            mood: 88,
            coins: 80,
          },
          tasks: [],
          systemMessages: [],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameActionsHarness({ coins: 1200 }));

    await act(async () => {
      const success = await result.current.giftXiaoxi('ring');
      expect(success).toBe(true);
    });

    expect(result.current.showCelebration).toBe(true);
    expect(result.current.celebrationType).toBe('roses');
    expect(result.current.avatarState).toBe('blush');
    expect(result.current.chatHistory.some((item) => item.id === 'gift-ai-1')).toBe(true);
  });

  test('feedXiaoxi blocks when coins are insufficient and emits an in-app warning', async () => {
    const notify = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useGameActionsHarness({ coins: 10, notify }));

    await act(async () => {
      const success = await result.current.feedXiaoxi('coffee');
      expect(success).toBe(false);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('爱心币不足哦，先去完成任务或者打赏补充一下吧。', 'warning', '余额不足');
  });
});
