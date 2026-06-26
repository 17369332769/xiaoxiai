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

// Builds a fetch Response-like object that streams the chat reply as SSE frames
// (a `delta` chunk, then a `done` frame carrying the authoritative payload) so
// the streaming sendMessage path can be exercised in tests.
function mockSseResponse(donePayload, deltas = ['…']) {
  const frames = deltas.map((text) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`);
  frames.push(`event: done\ndata: ${JSON.stringify(donePayload)}\n\n`);
  return mockRawSseResponse(frames);
}

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Streams an explicit list of raw SSE frame strings then ends — used to drive the
// edge paths (a mid-stream `error` frame, or a truncated stream with no `done`).
function mockRawSseResponse(frames) {
  const chunks = frames.map((frame) => new TextEncoder().encode(frame));
  let cursor = 0;
  return Promise.resolve({
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
  });
}

// A reader the test drives frame-by-frame, so it can inspect the live streaming
// placeholder between deltas (read() parks on a promise until the next push).
function createControllableSse() {
  const queue = [];
  const waiters = [];
  const encoder = new TextEncoder();
  const deliver = (item) => {
    if (waiters.length) waiters.shift()(item);
    else queue.push(item);
  };
  return {
    response: {
      ok: true,
      status: 200,
      headers: {
        get: (name) => (String(name).toLowerCase() === 'content-type'
          ? 'text/event-stream; charset=utf-8'
          : null),
      },
      body: {
        getReader: () => ({
          read: () => (queue.length
            ? Promise.resolve(queue.shift())
            : new Promise((resolve) => waiters.push(resolve))),
          cancel: () => { waiters.length = 0; return Promise.resolve(); },
        }),
      },
    },
    sendDelta: (text) => deliver({ value: encoder.encode(sseFrame('delta', { text })), done: false }),
    sendReset: () => deliver({ value: encoder.encode(sseFrame('reset', {})), done: false }),
    sendDone: (payload) => deliver({ value: encoder.encode(sseFrame('done', payload)), done: false }),
    close: () => deliver({ value: undefined, done: true }),
  };
}

// Flush the microtask chain (read -> decode -> onEvent -> setState) inside act().
async function flushStream() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
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
      if (input === '/api/chat/stream') {
        return mockSseResponse({
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
      if (input === '/api/chat/stream') {
        chatCalls += 1;

        if (chatCalls === 1) {
          return Promise.reject(new Error('temporary failure'));
        }

        return mockSseResponse({
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

  test('streams delta tokens into a live placeholder, then finalizes with the streamed flag', async () => {
    const stream = createControllableSse();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/chat/stream') {
        return Promise.resolve(stream.response);
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameActionsHarness());

    let sendPromise;
    await act(async () => {
      sendPromise = result.current.sendMessage('你好呀');
    });

    const placeholder = () => result.current.chatHistory.find((msg) => msg.sender === 'ai' && msg.streaming);
    expect(placeholder()).toBeTruthy();
    expect(placeholder().text).toBe('');

    stream.sendDelta('你');
    await flushStream();
    expect(placeholder().text).toBe('你');

    stream.sendDelta('好呀');
    await flushStream();
    expect(placeholder().text).toBe('你好呀');

    await act(async () => {
      stream.sendDone({
        aiMessage: { id: 'ai-stream-1', sender: 'ai', text: '你好呀，亲爱的～', avatarState: 'happy', timestamp: '10:20' },
        user: { level: 1, affection: 12, energy: 78, mood: 73, coins: 200 },
        tasks: [],
        systemMessages: [],
      });
      stream.close();
      const success = await sendPromise;
      expect(success).toBe(true);
    });

    const finalMessage = result.current.chatHistory.find((msg) => msg.id === 'ai-stream-1');
    expect(finalMessage).toBeTruthy();
    expect(finalMessage.streamed).toBe(true);
    expect(finalMessage.text).toBe('你好呀，亲爱的～');
    expect(result.current.chatHistory.some((msg) => msg.streaming)).toBe(false);
  });

  test('a reset frame clears the streamed tool lead-in before the grounded answer', async () => {
    const stream = createControllableSse();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/chat/stream') {
        return Promise.resolve(stream.response);
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const { result } = renderHook(() => useGameActionsHarness());

    let sendPromise;
    await act(async () => {
      sendPromise = result.current.sendMessage('北京天气怎么样？');
    });

    const placeholder = () => result.current.chatHistory.find((msg) => msg.sender === 'ai' && msg.streaming);

    // A tool-call lead-in streams first (DeepSeek prefixes the call with one).
    stream.sendDelta('好的，我来查一下~');
    await flushStream();
    expect(placeholder().text).toBe('好的，我来查一下~');

    // The reset clears that preview before the tool-grounded answer arrives.
    stream.sendReset();
    await flushStream();
    expect(placeholder().text).toBe('');

    // The real, weather-grounded answer streams in cleanly.
    stream.sendDelta('北京今天晴，记得多喝水哦~');
    await flushStream();
    expect(placeholder().text).toBe('北京今天晴，记得多喝水哦~');

    await act(async () => {
      stream.sendDone({
        aiMessage: { id: 'ai-reset-1', sender: 'ai', text: '北京今天晴，记得多喝水哦~', avatarState: 'happy', timestamp: '10:30' },
        user: { level: 1, affection: 12, energy: 78, mood: 73, coins: 200 },
        tasks: [],
        systemMessages: [],
      });
      stream.close();
      const success = await sendPromise;
      expect(success).toBe(true);
    });

    const finalMessage = result.current.chatHistory.find((msg) => msg.id === 'ai-reset-1');
    expect(finalMessage).toBeTruthy();
    expect(finalMessage.text).toBe('北京今天晴，记得多喝水哦~');
    expect(result.current.chatHistory.some((msg) => msg.streaming)).toBe(false);
  });

  test('surfaces a server-sent error frame as a failed send and clears the placeholder', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/chat/stream') {
        return mockRawSseResponse([
          sseFrame('delta', { text: '让我想想…' }),
          sseFrame('error', { message: '生成回复时出错了，请稍后再试。' }),
        ]);
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const notify = vi.fn();
    const { result } = renderHook(() => useGameActionsHarness({ notify }));

    await act(async () => {
      const success = await result.current.sendMessage('在吗');
      expect(success).toBe(false);
    });

    expect(notify).toHaveBeenCalledWith('生成回复时出错了，请稍后再试。', 'error', '发送失败');
    expect(result.current.lastFailedMessage).toBe('在吗');
    expect(result.current.chatHistory.some((msg) => msg.streaming)).toBe(false);
    expect(result.current.chatHistory.some((msg) => msg.sender === 'ai')).toBe(false);
    expect(result.current.chatHistory.some((msg) => msg.sender === 'system' && msg.text.includes('失败'))).toBe(true);
  });

  test('treats a stream that ends without a done frame as a failed send', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      if (input === '/api/chat/stream') {
        // Only a delta frame — the connection ends with no authoritative `done`.
        return mockRawSseResponse([sseFrame('delta', { text: '半句话…' })]);
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    });

    const notify = vi.fn();
    const { result } = renderHook(() => useGameActionsHarness({ notify }));

    await act(async () => {
      const success = await result.current.sendMessage('继续呀');
      expect(success).toBe(false);
    });

    expect(notify).toHaveBeenCalledWith('回复没有收完，请稍后再试。', 'error', '发送失败');
    expect(result.current.lastFailedMessage).toBe('继续呀');
    expect(result.current.chatHistory.some((msg) => msg.streaming)).toBe(false);
  });
});
