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
});
