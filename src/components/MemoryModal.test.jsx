import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import MemoryModal from './MemoryModal';

void React;

const MEMORIES = [
  { key: 'favorite_drink', value: '拿铁', weight: 3, updatedAt: '10:00' },
];

describe('MemoryModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('clears all memories after the user confirms the irreversible prompt', () => {
    const clearMemories = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryModal
        isOpen
        onClose={vi.fn()}
        memories={MEMORIES}
        memorySummary="小希记得你喜欢拿铁。"
        loadMemories={vi.fn()}
        deleteMemory={vi.fn()}
        clearMemories={clearMemories}
      />
    );

    fireEvent.click(screen.getByText('清空全部'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(clearMemories).toHaveBeenCalledTimes(1);
  });

  test('does not clear memories when the user cancels the confirmation', () => {
    const clearMemories = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <MemoryModal
        isOpen
        onClose={vi.fn()}
        memories={MEMORIES}
        memorySummary=""
        loadMemories={vi.fn()}
        deleteMemory={vi.fn()}
        clearMemories={clearMemories}
      />
    );

    fireEvent.click(screen.getByText('清空全部'));

    expect(clearMemories).not.toHaveBeenCalled();
  });

  test('disables the clear-all button when there are no memories', () => {
    render(
      <MemoryModal
        isOpen
        onClose={vi.fn()}
        memories={[]}
        memorySummary=""
        loadMemories={vi.fn()}
        deleteMemory={vi.fn()}
        clearMemories={vi.fn()}
      />
    );

    expect(screen.getByText('清空全部').closest('button')?.disabled).toBe(true);
  });
});
