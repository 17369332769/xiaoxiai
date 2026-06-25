import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ThemeModal from './ThemeModal';

void React;

const THEMES = [
  { id: 'default', name: '默认 · 甜粉', cost: 0, icon: '🌷', desc: '初见的甜粉', vars: { '--bg-gradient': '#100', '--primary-pink': '#f08' } },
  { id: 'starry', name: '星空 · 夜', cost: 600, icon: '🌌', desc: '深邃夜空', vars: { '--bg-gradient': '#001', '--primary-pink': '#08f' } },
];

describe('ThemeModal', () => {
  test('shows the equipped theme and equips an owned-but-inactive one', async () => {
    const equipTheme = vi.fn().mockResolvedValue(true);
    render(
      <ThemeModal
        isOpen
        onClose={vi.fn()}
        themes={THEMES}
        ownedThemes={['default', 'starry']}
        equippedTheme="default"
        coins={1000}
        unlockTheme={vi.fn()}
        equipTheme={equipTheme}
        notify={vi.fn()}
      />
    );

    // The default theme is equipped; starry is owned but inactive → "切换".
    expect(screen.getByText('使用中')).toBeTruthy();
    fireEvent.click(screen.getByText('切换'));
    await waitFor(() => expect(equipTheme).toHaveBeenCalledWith('starry'));
  });

  test('unlocks a locked theme when the user can afford it', async () => {
    const unlockTheme = vi.fn().mockResolvedValue(true);
    render(
      <ThemeModal
        isOpen
        onClose={vi.fn()}
        themes={THEMES}
        ownedThemes={['default']}
        equippedTheme="default"
        coins={1000}
        unlockTheme={unlockTheme}
        equipTheme={vi.fn()}
        notify={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('解锁 600'));
    await waitFor(() => expect(unlockTheme).toHaveBeenCalledWith('starry'));
  });

  test('blocks unlock and warns when coins are insufficient', () => {
    const unlockTheme = vi.fn();
    const notify = vi.fn();
    render(
      <ThemeModal
        isOpen
        onClose={vi.fn()}
        themes={THEMES}
        ownedThemes={['default']}
        equippedTheme="default"
        coins={100}
        unlockTheme={unlockTheme}
        equipTheme={vi.fn()}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('解锁 600'));
    expect(unlockTheme).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });
});
