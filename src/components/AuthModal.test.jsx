import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import AuthModal from './AuthModal';

void React;

function setup(props = {}) {
  const loginAccount = vi.fn().mockResolvedValue(true);
  const registerAccount = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  const notify = vi.fn();
  const utils = render(
    <AuthModal
      isOpen
      onClose={onClose}
      account={{ bound: false, identifier: null }}
      hasGuestProgress={false}
      registerAccount={registerAccount}
      loginAccount={loginAccount}
      logoutAccount={vi.fn()}
      notify={notify}
      {...props}
    />
  );
  // In the unbound view the only `.btn-primary` is the submit button (tabs are
  // btn-secondary), so this reliably targets it regardless of its changing label.
  const submitBtn = () => utils.container.querySelector('.btn-primary');
  const closeBtn = () => utils.container.querySelector('.close-btn');
  return { loginAccount, registerAccount, onClose, notify, submitBtn, closeBtn, ...utils };
}

function fillCredentials() {
  fireEvent.change(screen.getByPlaceholderText('例如 xiaoxi@example.com'), {
    target: { value: 'tester@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('请输入密码'), {
    target: { value: 'secret123' },
  });
}

describe('AuthModal', () => {
  test('an unbound guest WITH progress must confirm before a login discards it', async () => {
    const { loginAccount, submitBtn } = setup({ hasGuestProgress: true });
    fillCredentials();

    // First click only arms the confirm — it must NOT log in yet.
    fireEvent.click(submitBtn());
    expect(loginAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/不会合并到要登录的账号/)).toBeTruthy();
    expect(submitBtn().textContent).toContain('确认登录');

    // Second click confirms and logs in.
    fireEvent.click(submitBtn());
    await waitFor(() => expect(loginAccount).toHaveBeenCalledWith('tester@example.com', 'secret123'));
  });

  test('a guest WITHOUT progress logs in on the first click (no warning)', async () => {
    const { loginAccount, submitBtn } = setup({ hasGuestProgress: false });
    fillCredentials();

    fireEvent.click(submitBtn());
    await waitFor(() => expect(loginAccount).toHaveBeenCalledWith('tester@example.com', 'secret123'));
    expect(screen.queryByText(/不会合并到要登录的账号/)).toBeNull();
  });

  test('register binds current progress without a confirm step', async () => {
    const { registerAccount, loginAccount, submitBtn } = setup({ hasGuestProgress: true });
    // Switch to the register tab (the tab toggle button).
    fireEvent.click(screen.getByText('注册并绑定'));
    fillCredentials();

    fireEvent.click(submitBtn());
    await waitFor(() => expect(registerAccount).toHaveBeenCalledWith('tester@example.com', 'secret123'));
    expect(loginAccount).not.toHaveBeenCalled();
  });

  test('closing the modal re-arms the confirm (no one-click login after reopen)', () => {
    const { loginAccount, onClose, submitBtn, closeBtn } = setup({ hasGuestProgress: true });
    fillCredentials();

    // Arm the confirm...
    fireEvent.click(submitBtn());
    expect(submitBtn().textContent).toContain('确认登录');

    // ...then close. handleClose must reset the armed state.
    fireEvent.click(closeBtn());
    expect(onClose).toHaveBeenCalled();

    // A subsequent login click must re-arm (warn again), NOT log in immediately.
    fireEvent.click(submitBtn());
    expect(loginAccount).not.toHaveBeenCalled();
    expect(submitBtn().textContent).toContain('确认登录');
  });
});
