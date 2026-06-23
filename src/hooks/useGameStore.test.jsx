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

// Builds a fetch Response-like object that streams the chat reply as SSE frames
// (one `delta` per chunk, then a `done` frame carrying the authoritative
// payload) so the streaming sendMessage path can be exercised in tests.
function makeSseResponse(donePayload, deltas = ['…']) {
  const frames = deltas.map((text) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
  frames.push(`event: done\ndata: ${JSON.stringify(donePayload)}\n\n`);
  const chunks = frames.map((frame) => new TextEncoder().encode(frame));
  let cursor = 0;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'content-type'
        ? 'text/event-stream; charset=utf-8'
        : null),
    },
    body: {
      getReader: () => ({
        read: () => (cursor < chunks.length
          ? Promise.resolve({ value: chunks[cursor++], done: false })
          : Promise.resolve({ value: undefined, done: true })),
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

function mockSseResponse(donePayload, deltas) {
  return Promise.resolve(makeSseResponse(donePayload, deltas));
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
          relationship: {
            summary: '小希已经记住你喜欢甜甜的陪伴。',
            highlights: [{ key: 'favorite_drink', label: '常喝饮品', value: '拿铁' }],
            recentUpdates: [
              { id: 'memory-1', category: 'preference', categoryLabel: '偏好', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的常喝饮品：拿铁', timestamp: '10:01' },
            ],
          },
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
    expect(result.current.relationshipSummary).toContain('记住你喜欢甜甜的陪伴');
    expect(result.current.relationshipHighlights[0].value).toBe('拿铁');
    expect(result.current.relationshipRecentUpdates[0].text).toContain('常喝饮品');
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
          relationship: {
            summary: '',
            highlights: [],
          },
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

      if (input === '/api/chat/stream') {
        return mockSseResponse({
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
          relationship: {
            summary: '小希记住你今天想被温柔陪伴。',
            highlights: [{ key: 'stress_signal', label: '最近状态', value: '最近有点累，想被温柔安慰' }],
            recentUpdates: [
              { id: 'memory-chat-1', category: 'status', categoryLabel: '近况', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的最近状态：最近有点累，想被温柔安慰', timestamp: '10:01' },
            ],
          },
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
    expect(result.current.relationshipSummary).toContain('今天想被温柔陪伴');
    expect(result.current.relationshipHighlights[0].key).toBe('stress_signal');
    expect(result.current.relationshipRecentUpdates[0].category).toBe('status');
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

  test('stores the last failed check-in action and retries it successfully', async () => {
    let checkinCalls = 0;

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
        checkinCalls += 1;

        if (checkinCalls === 1) {
          return Promise.reject(new Error('check-in failed once'));
        }

        return mockJsonResponse({
          ok: true,
          aiMsg: {
            id: 'checkin-ai-retry',
            sender: 'ai',
            text: '补签成功',
            avatarState: 'happy',
            timestamp: '10:06',
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
      expect(result.current.isSyncing).toBe(false);
    });

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
    expect(result.current.lastFailedAction).toBe(null);
    expect(result.current.chatHistory.some((msg) => msg.id === 'checkin-ai-retry')).toBe(true);
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

      if (input === '/api/chat/stream') {
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
      resolveChatRequest(makeSseResponse({
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
      }));
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

      if (input === '/api/chat/stream') {
        chatCalls += 1;

        if (chatCalls === 1) {
          return Promise.reject(new Error('temporary failure'));
        }

        return mockSseResponse({
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

  test('stores the last failed task-claim action and retries it successfully', async () => {
    let claimCalls = 0;

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
            { id: 'chat_3', name: '聊天 3 次', reward: 30, progress: 3, target: 3, completed: true, claimed: false },
          ],
        });
      }

      if (input === '/api/task/claim') {
        claimCalls += 1;

        if (claimCalls === 1) {
          return Promise.reject(new Error('claim failed once'));
        }

        return mockJsonResponse({
          ok: true,
          sysMsg: {
            id: 'claim-sys-1',
            sender: 'system',
            text: '领取成功',
            timestamp: '10:07',
          },
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: 230,
          },
          tasks: [
            { id: 'chat_3', name: '聊天 3 次', reward: 30, progress: 3, target: 3, completed: true, claimed: true },
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
      const success = await result.current.claimTaskReward('chat_3');
      expect(success).toBe(false);
    });

    expect(result.current.lastFailedAction).toEqual({
      kind: 'task-claim',
      taskId: 'chat_3',
      label: '聊天 3 次',
    });

    await act(async () => {
      const success = await result.current.retryLastFailedAction();
      expect(success).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.tasks[0].claimed).toBe(true);
    });

    expect(claimCalls).toBe(2);
    expect(result.current.coins).toBe(230);
    expect(result.current.lastFailedAction).toBe(null);
    expect(result.current.chatHistory.some((msg) => msg.id === 'claim-sys-1')).toBe(true);
  });

  test('announces relationship memory updates after chat returns new memory details', async () => {
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
          relationship: {
            summary: '',
            highlights: [],
            recentUpdates: [],
          },
        });
      }

      if (input === '/api/chat/stream') {
        chatCalls += 1;

        return mockSseResponse({
          ok: true,
          aiMessage: {
            id: `ai-memory-${chatCalls}`,
            sender: 'ai',
            text: '我会好好记住你的~',
            avatarState: 'happy',
            timestamp: '10:08',
          },
          user: {
            level: 1,
            affection: 12,
            energy: 78,
            mood: 74,
            coins: 200,
          },
          tasks: [],
          systemMessages: [],
          relationship: {
            summary: '小希记住你常喝拿铁，也发现你最近有点累。',
            highlights: [
              { key: 'favorite_drink', label: '常喝饮品', value: '拿铁' },
            ],
            recentUpdates: [
              { id: 'persisted-memory-1', category: 'preference', categoryLabel: '偏好', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的常喝饮品：拿铁', timestamp: '10:08' },
            ],
          },
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    await act(async () => {
      const success = await result.current.sendMessage('请你记住我喜欢喝拿铁');
      expect(success).toBe(true);
    });

    expect(result.current.hasFreshRelationshipUpdate).toBe(true);
    expect(result.current.notifications.some((item) => item.title === '记忆更新')).toBe(true);
    expect(result.current.chatHistory.some((item) => item.sender === 'system' && item.text.includes('记忆更新'))).toBe(true);
    expect(result.current.relationshipRecentUpdates[0].text).toContain('常喝饮品');
    expect(result.current.relationshipRecentUpdates[0].category).toBe('preference');
    expect(result.current.relationshipRecentUpdates[0].categoryLabel).toBe('偏好');

    await waitFor(() => {
      expect(result.current.hasFreshRelationshipUpdate).toBe(false);
    }, { timeout: 5000 });
  }, 7000);

  test('does not append duplicate memory update timeline entries when relationship data is unchanged', async () => {
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
          relationship: {
            summary: '',
            highlights: [],
            recentUpdates: [],
          },
        });
      }

      if (input === '/api/chat/stream') {
        chatCalls += 1;

        return mockSseResponse({
          ok: true,
          aiMessage: {
            id: `ai-memory-repeat-${chatCalls}`,
            sender: 'ai',
            text: '我会一直记得你的。',
            avatarState: 'happy',
            timestamp: '10:09',
          },
          user: {
            level: 1,
            affection: 12 + chatCalls,
            energy: 78,
            mood: 74,
            coins: 200,
          },
          tasks: [],
          systemMessages: [],
          relationship: {
            summary: '小希记住你常喝拿铁。',
            highlights: [
              { key: 'favorite_drink', label: '常喝饮品', value: '拿铁' },
            ],
            recentUpdates: [
              { id: 'persisted-memory-repeat', category: 'preference', categoryLabel: '偏好', sourceType: 'local_memory', sourceLabel: '规则提取', confidence: 'high', confidenceLabel: '高可信', text: '小希刚记住了你的常喝饮品：拿铁', timestamp: '10:09' },
            ],
          },
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    await act(async () => {
      await result.current.sendMessage('请记住我喜欢拿铁');
    });

    await act(async () => {
      await result.current.sendMessage('再记一遍我喜欢拿铁');
    });

    const memoryUpdateMessages = result.current.chatHistory.filter(
      (item) => item.sender === 'system' && item.text.includes('记忆更新')
    );

    expect(memoryUpdateMessages).toHaveLength(1);
    expect(result.current.relationshipRecentUpdates).toHaveLength(1);
  });

  test('clearMemories wipes the local memory list and summary after a successful call', async () => {
    let clearCalls = 0;

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

      if (input === '/api/memory/list') {
        return mockJsonResponse({
          ok: true,
          summary: '小希记得你喜欢拿铁。',
          memories: [
            { key: 'favorite_drink', value: '拿铁', weight: 3, updatedAt: '10:00' },
          ],
        });
      }

      if (input === '/api/memory/clear') {
        clearCalls += 1;
        return mockJsonResponse({ ok: true, cleared: 1 });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    await act(async () => {
      await result.current.loadMemories();
    });

    await waitFor(() => {
      expect(result.current.memories).toHaveLength(1);
    });
    expect(result.current.memorySummary).toBe('小希记得你喜欢拿铁。');

    await act(async () => {
      const success = await result.current.clearMemories();
      expect(success).toBe(true);
    });

    expect(clearCalls).toBe(1);
    expect(result.current.memories).toHaveLength(0);
    expect(result.current.memorySummary).toBe('');
  });

  test('real payment flow: create order, poll query, then settle via gateway callback', async () => {
    let syncCalls = 0;
    let queryCalls = 0;
    let createBody = null;
    let callbackBody = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const body = init?.body ? JSON.parse(init.body) : {};

      if (input === '/api/user/sync') {
        syncCalls += 1;
        // First sync seeds 200 coins; the post-payment re-sync reflects the top-up.
        return mockJsonResponse({
          ok: true,
          user: {
            level: 1,
            affection: 10,
            energy: 80,
            mood: 70,
            coins: syncCalls === 1 ? 200 : 1400,
            hasCheckedInToday: false,
          },
          chatHistory: [],
          tasks: [],
        });
      }

      if (input === '/api/order/create') {
        createBody = body;
        return mockJsonResponse({
          ok: true,
          order: { id: 'order-1', outTradeNo: 'XX-1', amount: 52, coins: 1200, paymentMethod: 'wechat', status: 'pending' },
          coins: 1200,
          qrContent: 'xiaoxiai://pay?out_trade_no=XX-1&amount=52',
          simulatedCallback: { out_trade_no: 'XX-1', total_amount: 52, gateway_txn_id: 'WX1', result: 'SUCCESS', sign: 'sig' },
        });
      }

      if (input === '/api/order/query') {
        queryCalls += 1;
        // Pending on the first poll, paid on the second.
        return mockJsonResponse({
          ok: true,
          order: { id: 'order-1', outTradeNo: 'XX-1', amount: 52, coins: 1200, paymentMethod: 'wechat', status: queryCalls === 1 ? 'pending' : 'paid' },
        });
      }

      if (input === '/api/payment/callback') {
        callbackBody = body;
        return mockJsonResponse({
          ok: true,
          settled: true,
          alreadyPaid: false,
          status: 'paid',
          coins: 1400,
          order: { id: 'order-1', outTradeNo: 'XX-1', amount: 52, coins: 1200, paymentMethod: 'wechat', status: 'paid' },
        });
      }

      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    await waitFor(() => {
      expect(result.current.isSyncing).toBe(false);
    });

    // 1. Create the order.
    let created;
    await act(async () => {
      created = await result.current.createOrder(52, 'wechat');
    });
    expect(createBody).toEqual({ userId: expect.any(String), amount: 52, paymentMethod: 'wechat' });
    expect(created.order.id).toBe('order-1');
    expect(created.qrContent).toContain('xiaoxiai://pay');

    // 2. Poll until the backend reports the order paid.
    let firstQuery;
    await act(async () => {
      firstQuery = await result.current.queryOrder({ orderId: 'order-1' });
    });
    expect(firstQuery.status).toBe('pending');

    let secondQuery;
    await act(async () => {
      secondQuery = await result.current.queryOrder({ orderId: 'order-1' });
    });
    expect(secondQuery.status).toBe('paid');

    // 3. Replay the gateway callback to settle, then the store re-syncs.
    let confirmed;
    await act(async () => {
      confirmed = await result.current.confirmPayment(created.simulatedCallback);
    });
    expect(confirmed.settled).toBe(true);
    expect(callbackBody).toEqual(created.simulatedCallback);

    await waitFor(() => {
      expect(result.current.coins).toBe(1400);
    });
    expect(syncCalls).toBeGreaterThanOrEqual(2);
  });

  test('exposes allowSimulatedPayment from sync and flags guest progress', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          user: { level: 3, affection: 25, energy: 80, mood: 70, coins: 456, hasCheckedInToday: false },
          chatHistory: [],
          tasks: [],
          allowSimulatedPayment: true,
        });
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());
    await waitFor(() => expect(result.current.isSyncing).toBe(false));

    expect(result.current.allowSimulatedPayment).toBe(true);
    // Unbound guest at level 3 / non-default coins → has progress worth warning.
    expect(result.current.hasGuestProgress).toBe(true);
  });

  test('defaults allowSimulatedPayment to false and reports no guest progress for a fresh profile', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        return mockJsonResponse({
          ok: true,
          // Exactly the fresh-guest baseline; no allowSimulatedPayment field (older server).
          user: { level: 1, affection: 10, energy: 80, mood: 70, coins: 200, hasCheckedInToday: false },
          chatHistory: [],
          tasks: [],
        });
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());
    await waitFor(() => expect(result.current.isSyncing).toBe(false));

    expect(result.current.allowSimulatedPayment).toBe(false);
    expect(result.current.hasGuestProgress).toBe(false);
  });

  test('recovers from an AUTH_REQUIRED sync by dropping the stale token and falling back to a guest', async () => {
    try {
      localStorage.setItem('xxa_user_id', 'bound_user_x');
      localStorage.setItem('xxa_token', 'stale-token');
    } catch { /* ignore */ }

    let syncCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/user/sync') {
        syncCalls += 1;
        if (syncCalls === 1) {
          // Bound id + stale token → backend rejects with AUTH_REQUIRED (401).
          return mockJsonResponse(
            { ok: false, error: { code: 'AUTH_REQUIRED', message: '该身份已绑定账号，请登录后再操作' } },
            false,
            401
          );
        }
        // After recovery rotates to a fresh guest id, this sync succeeds.
        return mockJsonResponse({
          ok: true,
          user: { level: 1, affection: 10, energy: 80, mood: 70, coins: 200, hasCheckedInToday: false },
          chatHistory: [],
          tasks: [],
        });
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameStore());

    // The recovery re-syncs as a guest; the second sync resolves the loading state.
    await waitFor(() => expect(result.current.isSyncing).toBe(false));

    expect(syncCalls).toBeGreaterThanOrEqual(2);
    // Stale token cleared, account unbound, user prompted to re-login (not a wedge).
    expect(localStorage.getItem('xxa_token')).toBe(null);
    expect(result.current.account.bound).toBe(false);
    expect(result.current.notifications.some((n) => n.title === '请重新登录')).toBe(true);
    // No "backend down" error banner — this is an auth recovery, not a connection failure.
    expect(result.current.syncError).toBe('');
    expect(result.current.level).toBe(1);
  });
});
