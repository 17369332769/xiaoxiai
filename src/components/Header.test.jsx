import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import Header from './Header';

void React;

describe('Header', () => {
  test('shows an in-app hint when browser audio playback is blocked', async () => {
    const notify = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('blocked'));

    render(
      <Header
        onlineCount={1314}
        coins={200}
        dailyCheckIn={vi.fn()}
        isCheckInCompleted={false}
        isCheckInPending={false}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByTitle('播放甜美背景音乐'));

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        '浏览器拦截了背景音乐播放，再点一次音符按钮通常就能开启。',
        'info',
        '播放提示'
      );
    });
  });

  test('shows a pending label and disables check-in while signing in', () => {
    render(
      <Header
        onlineCount={1314}
        coins={200}
        dailyCheckIn={vi.fn()}
        isCheckInCompleted={false}
        isCheckInPending
        notify={vi.fn()}
      />
    );

    expect(screen.getByText('签到中...')).not.toBeNull();
    expect(screen.getByRole('button', { name: /签到中/ }).disabled).toBe(true);
  });
});
