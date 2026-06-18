import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { FOOD_ITEMS, GIFT_ITEMS, TIPPING_TIERS } from '../../shared/gameConfig.js';

function mockJsonResponse(payload, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => payload,
  });
}

describe('useGameStore', () => {
  test('syncs initial user state from backend on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 3,
            affection: 25,
            energy: 77,
            mood: 88,
            coins: 456,
            hasCheckedInToday: true,
          },
          chatHistory: [
            { id: 'welcome', sender: 'ai', text: '你好呀', avatarState: 'normal', timestamp: '10:00' },
          ],
          tasks: [
            { id: 'checkin', name: '每日签到', reward: 50, progress: 1, target: 1, completed: true, claimed: false },
          ],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.level).toBe(3);
    });

    expect(result.current.affection).toBe(25);
    expect(result.current.energy).toBe(77);
    expect(result.current.mood).toBe(88);
    expect(result.current.coins).toBe(456);
    expect(result.current.hasCheckedInToday).toBe(true);
    expect(result.current.chatHistory).toHaveLength(1);
    expect(result.current.tasks[0].id).toBe('checkin');
  });

  test('exposes shared game configuration as the storefront source of truth', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 200,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(0);
    });

    expect(result.current.FOOD_ITEMS).toEqual(FOOD_ITEMS);
    expect(result.current.GIFT_ITEMS).toEqual(GIFT_ITEMS);
    expect(result.current.TIPPING_TIERS).toEqual(TIPPING_TIERS);
  });

  test('sendMessage appends AI reply and updates user state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 200,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      if (input === '/api/chat') {
        return mockJsonResponse({
          ok: true,
          aiMessage: {
            id: 'ai-1',
            sender: 'ai',
            text: '小希来啦~',
            avatarState: 'happy',
            timestamp: '10:01',
          },
          user: {
            level: 2,
            affection: 30,
            energy: 78,
            mood: 76,
            coins: 200,
          },
          tasks: [
            { id: 'chat_3', name: '聊天 3 次', reward: 30, progress: 1, target: 3, completed: false, claimed: false },
          ],
          systemMessages: [
            { id: 'sys-level', sender: 'system', text: '升级啦', timestamp: '10:01' },
          ],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    await act(async () => {
      await result.current.sendMessage('你好，小希');
    });

    await waitFor(() => {
      expect(result.current.chatHistory.some(msg => msg.id === 'ai-1')).toBe(true);
    });

    expect(result.current.level).toBe(2);
    expect(result.current.affection).toBe(30);
    expect(result.current.energy).toBe(78);
    expect(result.current.mood).toBe(76);
    expect(result.current.avatarState).toBe('happy');
    expect(result.current.tasks[0].id).toBe('chat_3');
    expect(result.current.chatHistory.some(msg => msg.text === '升级啦')).toBe(true);
  });

  test('dailyCheckIn updates sign-in state after successful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 200,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [
            { id: 'checkin', name: '每日签到', reward: 50, progress: 0, target: 1, completed: false, claimed: false },
          ],
        });
      }

      if (input === '/api/checkin') {
        return mockJsonResponse({
          ok: true,
          aiMsg: {
            id: 'checkin-ai',
            sender: 'ai',
            text: '签到成功',
            avatarState: 'happy',
            timestamp: '10:02',
          },
          tasks: [
            { id: 'checkin', name: '每日签到', reward: 50, progress: 1, target: 1, completed: true, claimed: false },
          ],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(1);
    });

    await act(async () => {
      await result.current.dailyCheckIn();
    });

    await waitFor(() => {
      expect(result.current.hasCheckedInToday).toBe(true);
    });

    expect(result.current.avatarState).toBe('happy');
    expect(result.current.tasks[0].completed).toBe(true);
    expect(result.current.chatHistory.some(msg => msg.id === 'checkin-ai')).toBe(true);
  });

  test('giftXiaoxi publishes an in-app warning instead of using alert when coins are insufficient', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 200,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    await act(async () => {
      const success = await result.current.giftXiaoxi('ring');
      expect(success).toBe(false);
    });

    expect(alertSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.notifications.some(notification => notification.title === '余额不足')).toBe(true);
    });
  });

  test('prevents duplicate chat submissions while a send is already in flight', async () => {
    let resolveChatRequest;
    const chatRequest = new Promise((resolve) => {
      resolveChatRequest = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 200,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      if (input === '/api/chat') {
        return chatRequest;
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    let firstPromise;
    await act(async () => {
      firstPromise = result.current.sendMessage('第一条消息');
    });

    expect(result.current.isSendingMessage).toBe(true);

    let secondResult;
    await act(async () => {
      secondResult = await result.current.sendMessage('第二条消息');
    });

    expect(secondResult).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveChatRequest({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          aiMessage: {
            id: 'ai-dup-1',
            sender: 'ai',
            text: '小希收到啦~',
            avatarState: 'happy',
            timestamp: '10:01',
          },
          user: {
            level: 1,
            affection: 12,
            energy: 78,
            mood: 72,
            coins: 200,
          },
          tasks: [],
          systemMessages: [],
        }),
      });
      await firstPromise;
    });

    await waitFor(() => {
      expect(result.current.isSendingMessage).toBe(false);
    });
  });

  test('aborts in-flight sync requests when the store unmounts', async () => {
    let observedSignal;
    let releaseSync;
    const syncRequest = new Promise((resolve) => {
      releaseSync = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (input === '/api/user/sync') {
        observedSignal = init?.signal;
        return syncRequest;
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { unmount } = renderHook(() => useGameStore());

    expect(observedSignal).toBeDefined();
    expect(observedSignal.aborted).toBe(false);

    unmount();

    expect(observedSignal.aborted).toBe(true);

    await act(async () => {
      releaseSync({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          user: {
            level: 9,
            affection: 99,
            energy: 99,
            mood: 99,
            coins: 999,
            hasCheckedInToday: true,
          },
          chatHistory: [],
          tasks: [],
        }),
      });
      await Promise.resolve();
    });
  });

  test('exposes a retry action after sync failure and recovers on a later success', async () => {
    let syncCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        syncCalls += 1;

        if (syncCalls === 1) {
          return Promise.reject(new Error('backend offline'));
        }

        return mockJsonResponse({
          ok: true,
          user: {
            level: 4,
            affection: 44,
            energy: 84,
            mood: 91,
            coins: 520,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    expect(result.current.syncError).toContain('当前无法连接到后端服务');

    await act(async () => {
      result.current.retrySync();
    });

    await waitFor(() => {
      expect(result.current.level).toBe(4);
    });

    expect(syncCalls).toBe(2);
    expect(result.current.syncError).toBe('');
    expect(result.current.coins).toBe(520);
  });

  test('stores the last failed chat message and retries it successfully', async () => {
    let chatCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 200,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      if (input === '/api/chat') {
        chatCalls += 1;

        if (chatCalls === 1) {
          return Promise.reject(new Error('temporary failure'));
        }

        return mockJsonResponse({
          ok: true,
          aiMessage: {
            id: 'ai-retry-1',
            sender: 'ai',
            text: '这次我收到啦~',
            avatarState: 'happy',
            timestamp: '10:03',
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

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    await act(async () => {
      const success = await result.current.sendMessage('亲爱的你在吗');
      expect(success).toBe(false);
    });

    expect(result.current.lastFailedMessage).toBe('亲爱的你在吗');

    await act(async () => {
      const success = await result.current.retryLastFailedMessage();
      expect(success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.chatHistory.some((msg) => msg.id === 'ai-retry-1')).toBe(true);
    });

    expect(chatCalls).toBe(2);
    expect(result.current.lastFailedMessage).toBe('');
  });

  test('stores the last failed purchase action and retries it successfully', async () => {
    let feedCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 200,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      if (input === '/api/action/feed') {
        feedCalls += 1;

        if (feedCalls === 1) {
          return Promise.reject(new Error('feed failed once'));
        }

        return mockJsonResponse({
          ok: true,
          sysMsg: {
            id: 'feed-sys-1',
            sender: 'system',
            text: '喂食成功',
            timestamp: '10:04',
          },
          aiMsg: {
            id: 'feed-ai-1',
            sender: 'ai',
            text: '小希吃饱啦',
            avatarState: 'happy',
            timestamp: '10:04',
          },
          user: {
            level: 1,
            affection: 15,
            energy: 95,
            mood: 70,
            coins: 170,
          },
          tasks: [],
          systemMessages: [],
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    await act(async () => {
      const success = await result.current.feedXiaoxi('coffee');
      expect(success).toBe(false);
    });

    expect(result.current.lastFailedAction).toEqual({
      kind: 'food',
      itemId: 'coffee',
      label: '香浓拿铁 (Latte)',
    });

    await act(async () => {
      const success = await result.current.retryLastFailedAction();
      expect(success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.chatHistory.some((msg) => msg.id === 'feed-ai-1')).toBe(true);
    });

    expect(feedCalls).toBe(2);
    expect(result.current.lastFailedAction).toBe(null);
  });
});
