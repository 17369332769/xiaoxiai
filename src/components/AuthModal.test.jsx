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
    // registerAccount now takes an optional 3rd OTP code arg (undefined when OTP is off).
    await waitFor(() => expect(registerAccount).toHaveBeenCalledWith('tester@example.com', 'secret123', undefined));
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

  test('a logged-in account can export their data as a download', async () => {
    // jsdom lacks object URLs; stub them so downloadJson succeeds.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const exportUserData = vi.fn().mockResolvedValue({ user: { id: 'u1' } });
    const notify = vi.fn();

    render(
      <AuthModal
        isOpen
        onClose={vi.fn()}
        account={{ bound: true, identifier: 'me@example.com' }}
        exportUserData={exportUserData}
        deleteAccount={vi.fn()}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('导出我的数据（JSON）'));
    await waitFor(() => expect(exportUserData).toHaveBeenCalledTimes(1));
    // With the object URL stubbed, downloadJson succeeds → the success message.
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('你的数据已导出为 JSON 文件，请查收下载~', 'success', '数据导出')
    );
  });

  test('a failed export (null) neither downloads nor double-notifies', async () => {
    const exportUserData = vi.fn().mockResolvedValue(null);
    const notify = vi.fn();

    render(
      <AuthModal
        isOpen
        onClose={vi.fn()}
        account={{ bound: true, identifier: 'me@example.com' }}
        exportUserData={exportUserData}
        deleteAccount={vi.fn()}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('导出我的数据（JSON）'));
    await waitFor(() => expect(exportUserData).toHaveBeenCalledTimes(1));
    // The store already notified its own error; the modal must not double-notify.
    expect(notify).not.toHaveBeenCalled();
  });

  test('account deletion requires a two-step confirm', async () => {
    const deleteAccount = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    const notify = vi.fn();

    render(
      <AuthModal
        isOpen
        onClose={onClose}
        account={{ bound: true, identifier: 'me@example.com' }}
        exportUserData={vi.fn()}
        deleteAccount={deleteAccount}
        notify={notify}
      />
    );

    // First click only arms the confirm — it must NOT delete yet.
    fireEvent.click(screen.getByText('注销账号'));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText(/永久删除账号/)).toBeTruthy();

    // Second click (relabeled) actually deletes and closes.
    fireEvent.click(screen.getByText('确认永久注销账号'));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('a failed deletion stays armed (warning visible) for a one-click retry', async () => {
    const deleteAccount = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();

    render(
      <AuthModal
        isOpen
        onClose={onClose}
        account={{ bound: true, identifier: 'me@example.com' }}
        exportUserData={vi.fn()}
        deleteAccount={deleteAccount}
        notify={vi.fn()}
      />
    );

    // Arm, then confirm — the delete fails.
    fireEvent.click(screen.getByText('注销账号'));
    fireEvent.click(screen.getByText('确认永久注销账号'));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));

    // Stays armed: warning still visible, button still in confirm state, no close.
    expect(screen.getByText(/永久删除账号/)).toBeTruthy();
    expect(screen.getByText('确认永久注销账号')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    // A retry click attempts the delete again (the warning was visible throughout).
    fireEvent.click(screen.getByText('确认永久注销账号'));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(2));
  });

  test('closing the modal disarms a pending deletion', () => {
    const onClose = vi.fn();
    const props = {
      account: { bound: true, identifier: 'me@example.com' },
      exportUserData: vi.fn(),
      deleteAccount: vi.fn(),
      notify: vi.fn(),
    };
    const { container, rerender } = render(<AuthModal isOpen onClose={onClose} {...props} />);

    fireEvent.click(screen.getByText('注销账号'));
    expect(screen.getByText('确认永久注销账号')).toBeTruthy();

    // Close via the × button; handleClose must disarm the pending deletion.
    fireEvent.click(container.querySelector('.close-btn'));
    expect(onClose).toHaveBeenCalled();

    // Parent closes then reopens the (never-unmounted) modal.
    rerender(<AuthModal isOpen={false} onClose={onClose} {...props} />);
    rerender(<AuthModal isOpen onClose={onClose} {...props} />);

    // Back to the un-armed label — a single click can't delete after a reopen.
    expect(screen.getByText('注销账号')).toBeTruthy();
    expect(screen.queryByText('确认永久注销账号')).toBeNull();
  });

  test('the account panel links to the privacy policy and terms of service', () => {
    render(
      <AuthModal
        isOpen
        onClose={vi.fn()}
        account={{ bound: true, identifier: 'me@example.com' }}
        exportUserData={vi.fn()}
        deleteAccount={vi.fn()}
        notify={vi.fn()}
      />
    );

    expect(screen.getByText('隐私政策').getAttribute('href')).toBe('/privacy.html');
    expect(screen.getByText('服务条款').getAttribute('href')).toBe('/terms.html');
  });

  test('the login view offers a forgot-password reset flow', async () => {
    const requestAuthCode = vi.fn().mockResolvedValue({ ok: true, sent: true, devCode: '123456' });
    const resetPassword = vi.fn().mockResolvedValue(true);
    setup({ requestAuthCode, resetPassword });

    // Enter the reset view from the login tab.
    fireEvent.click(screen.getByText('忘记密码？'));
    expect(screen.getByText('重置密码')).toBeTruthy();

    // Fill the identifier and request a reset code.
    fireEvent.change(screen.getByPlaceholderText('例如 xiaoxi@example.com'), { target: { value: 'tester@example.com' } });
    fireEvent.click(screen.getByText('发送验证码'));
    await waitFor(() => expect(requestAuthCode).toHaveBeenCalledWith('tester@example.com', 'reset'));

    // Fill the code + new password and reset.
    fireEvent.change(screen.getByPlaceholderText('请输入收到的验证码'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('请输入新密码'), { target: { value: 'newpass456' } });
    fireEvent.click(screen.getByText('重置密码并登录'));
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('tester@example.com', '123456', 'newpass456'));
  });

  test('the register tab shows an OTP code field when registration requires it', async () => {
    const requestAuthCode = vi.fn().mockResolvedValue({ ok: true, sent: true, devCode: '654321' });
    setup({ requireRegistrationOtp: true, requestAuthCode });

    fireEvent.click(screen.getByText('注册并绑定'));
    fireEvent.change(screen.getByPlaceholderText('例如 xiaoxi@example.com'), { target: { value: 'newbie@example.com' } });
    expect(screen.getByPlaceholderText('请输入收到的验证码')).toBeTruthy();

    fireEvent.click(screen.getByText('发送验证码'));
    await waitFor(() => expect(requestAuthCode).toHaveBeenCalledWith('newbie@example.com', 'register'));
  });
});
