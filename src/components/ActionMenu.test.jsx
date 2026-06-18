import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ActionMenu from './ActionMenu';

void React;

describe('ActionMenu', () => {
  test('shows a retry banner for failed task claims and retries when clicked', () => {
    const retryLastFailedAction = vi.fn();

    render(
      <ActionMenu
        tasks={[
          { id: 'chat_3', name: '聊天 3 次', reward: 30, progress: 3, target: 3, completed: true, claimed: false },
        ]}
        claimTaskReward={vi.fn()}
        openShop={vi.fn()}
        openTipping={vi.fn()}
        claimingTaskIds={[]}
        lastFailedAction={{ kind: 'task-claim', taskId: 'chat_3', label: '聊天 3 次' }}
        retryLastFailedAction={retryLastFailedAction}
      />
    );

    expect(screen.getByText('上一次领奖失败')).not.toBeNull();
    expect(screen.getByText('聊天 3 次')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试领奖' }));
    expect(retryLastFailedAction).toHaveBeenCalledTimes(1);
  });
});
