import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ChatBox from './ChatBox';

void React;

describe('ChatBox', () => {
  test('sends the typed message and clears the input', () => {
    const sendMessage = vi.fn();

    render(
      <ChatBox
        chatHistory={[]}
        sendMessage={sendMessage}
      />
    );

    const input = screen.getByPlaceholderText('说点甜言蜜语逗小希开心吧...');
    fireEvent.change(input, { target: { value: '你好呀，小希' } });
    fireEvent.click(screen.getByTitle('发送消息'));

    expect(sendMessage).toHaveBeenCalledWith('你好呀，小希');
    expect(input.value).toBe('');
  });

  test('clicking a quick prompt sends that preset text', () => {
    const sendMessage = vi.fn();

    render(
      <ChatBox
        chatHistory={[]}
        sendMessage={sendMessage}
      />
    );

    fireEvent.click(screen.getByText('今天有点累，求安抚...'));

    expect(sendMessage).toHaveBeenCalledWith('今天有点累，求安抚...');
  });

  test('disables sending controls while a message is in flight', () => {
    const sendMessage = vi.fn();

    render(
      <ChatBox
        chatHistory={[]}
        sendMessage={sendMessage}
        isSendingMessage
      />
    );

    expect(screen.getByPlaceholderText('说点甜言蜜语逗小希开心吧...').disabled).toBe(true);
    expect(screen.getByTitle('消息发送中').disabled).toBe(true);

    fireEvent.click(screen.getByText('今天有点累，求安抚...'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('shows a retry banner for the last failed message and retries it', () => {
    const retryLastFailedMessage = vi.fn();

    render(
      <ChatBox
        chatHistory={[]}
        sendMessage={vi.fn()}
        lastFailedMessage="别走呀，小希"
        retryLastFailedMessage={retryLastFailedMessage}
      />
    );

    expect(screen.getByText('上一条消息发送失败')).not.toBeNull();
    expect(screen.getByText('别走呀，小希')).not.toBeNull();

    fireEvent.click(screen.getByText('重试发送'));
    expect(retryLastFailedMessage).toHaveBeenCalled();
  });

  test('renders a streaming reply as live text immediately (no client typewriter)', () => {
    // A normal latest AI reply types out from empty via setInterval; a streaming
    // bubble must show its server-streamed text right away with a caret.
    const { container } = render(
      <ChatBox
        chatHistory={[
          { id: 'ai-stream', sender: 'ai', text: '你好呀，亲爱的', avatarState: 'normal', streaming: true, timestamp: '10:20' },
        ]}
        sendMessage={vi.fn()}
      />
    );

    expect(container.textContent).toContain('你好呀，亲爱的');
  });

  test('labels AI replies with a visible "AI 生成" badge (compliance disclosure)', () => {
    render(
      <ChatBox
        chatHistory={[
          { id: 'u1', sender: 'user', text: '你好呀', timestamp: '10:00' },
          { id: 'ai1', sender: 'ai', text: '你好，亲爱的～', avatarState: 'normal', timestamp: '10:01' },
        ]}
        sendMessage={vi.fn()}
      />
    );

    // Exactly one badge — on the AI bubble, not the user bubble.
    const badges = screen.getAllByText('AI 生成');
    expect(badges).toHaveLength(1);
  });

  test('renders a URL in an AI reply as a clickable new-tab link', () => {
    render(
      <ChatBox
        chatHistory={[
          { id: 'ai-url', sender: 'ai', text: 'OpenAI 官网是 https://openai.com 哦～', avatarState: 'normal', streaming: true, timestamp: '10:21' },
        ]}
        sendMessage={vi.fn()}
      />
    );

    const link = screen.getByRole('link', { name: 'https://openai.com' });
    expect(link.getAttribute('href')).toBe('https://openai.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  test('clicking a relationship update system message triggers the focus callback', () => {
    const onRelationshipUpdateClick = vi.fn();

    render(
      <ChatBox
        chatHistory={[
          { id: 'sys-memory-1', sender: 'system', text: '📝 记忆更新：小希刚记住了你的常喝饮品：拿铁', timestamp: '10:10' },
        ]}
        sendMessage={vi.fn()}
        onRelationshipUpdateClick={onRelationshipUpdateClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /记忆更新/ }));
    expect(onRelationshipUpdateClick).toHaveBeenCalledTimes(1);
  });
});
