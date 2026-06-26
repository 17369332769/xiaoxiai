import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import StoryModal from './StoryModal';

void React;

const STORIES = [
  {
    id: 'rainy_meet', title: '初遇', icon: '☔', requiredLevel: 1, reward: { coins: 100 },
    summary: '初遇的雨夜',
    scenes: [
      { who: 'narration', text: '那是一个雨夜。' },
      {
        who: 'choice', text: '她把伞递过来，等你回答。',
        options: [
          { text: '一起走吧', reply: '嗯！一起走才不无聊~', emotion: 'happy', affection: 3 },
          { text: '不用了', reply: '真是的，会感冒的啦……', emotion: 'normal', affection: 1 },
        ],
      },
      { who: 'xiaoxi', emotion: 'happy', text: '我叫小希呀~' },
    ],
  },
  {
    id: 'future_promise', title: '约定', icon: '💍', requiredLevel: 8, reward: { coins: 500 },
    summary: '未来的约定',
    scenes: [{ who: 'narration', text: '很久以后……' }],
  },
];

describe('StoryModal', () => {
  test('lists episodes with unlocked-unread and locked states', () => {
    render(
      <StoryModal
        isOpen
        onClose={vi.fn()}
        stories={STORIES}
        readStories={[]}
        level={1}
        claimStory={vi.fn()}
        notify={vi.fn()}
      />
    );

    expect(screen.getByText('阅读')).toBeTruthy();
    expect(screen.getByText('Lv.8')).toBeTruthy();
  });

  test('player choice gates progress, shows 小希 reaction, and claims with the picks', async () => {
    const claimStory = vi.fn().mockResolvedValue({
      rewarded: true, reward: { coins: 100, affection: 3 }, read: ['rainy_meet'],
      user: { level: 1, affection: 13, energy: 80, mood: 70, coins: 300 },
    });
    const notify = vi.fn();
    render(
      <StoryModal
        isOpen
        onClose={vi.fn()}
        stories={STORIES}
        readStories={[]}
        level={1}
        claimStory={claimStory}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('阅读'));
    expect(screen.getByText('那是一个雨夜。')).toBeTruthy();
    fireEvent.click(screen.getByText('下一句'));

    // At the choice scene: options are shown and progress is blocked until a pick.
    expect(screen.getByText('她把伞递过来，等你回答。')).toBeTruthy();
    expect(screen.queryByText('下一句')).toBeNull();
    fireEvent.click(screen.getByText('一起走吧'));

    // 小希 reacts to the choice, and progress unlocks.
    expect(screen.getByText('嗯！一起走才不无聊~')).toBeTruthy();
    fireEvent.click(screen.getByText('下一句'));

    expect(screen.getByText('我叫小希呀~')).toBeTruthy();
    fireEvent.click(screen.getByText('读完啦 · 领取心意'));

    await waitFor(() => expect(claimStory).toHaveBeenCalledWith('rainy_meet', [{ scene: 1, option: 0 }]));
    await waitFor(() => expect(notify).toHaveBeenCalled());
  });

  test('a finished episode can be re-read without a fresh reward notice', async () => {
    const claimStory = vi.fn().mockResolvedValue({
      rewarded: false, read: ['rainy_meet'],
      user: { level: 1, affection: 13, energy: 80, mood: 70, coins: 300 },
    });
    const notify = vi.fn();
    render(
      <StoryModal
        isOpen
        onClose={vi.fn()}
        stories={STORIES}
        readStories={['rainy_meet']}
        level={1}
        claimStory={claimStory}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('重温'));
    fireEvent.click(screen.getByText('下一句'));
    fireEvent.click(screen.getByText('不用了'));
    fireEvent.click(screen.getByText('下一句'));
    fireEvent.click(screen.getByText('读完啦'));

    await waitFor(() => expect(claimStory).toHaveBeenCalledWith('rainy_meet', [{ scene: 1, option: 1 }]));
    expect(notify).not.toHaveBeenCalled();
  });
});
