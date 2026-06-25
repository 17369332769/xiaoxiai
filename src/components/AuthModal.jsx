import * as React from 'react';
import { downloadJson } from '../utils/download.js';

const { useState } = React;

export default function AuthModal({
  isOpen,
  onClose,
  account,
  authPending = false,
  hasGuestProgress = false,
  registerAccount,
  loginAccount,
  logoutAccount,
  requireRegistrationOtp = false,
  requestAuthCode,
  resetPassword,
  exportUserData,
  deleteAccount,
  notify,
}) {
  const [tab, setTab] = useState('login'); // 'login' or 'register'
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // Two-step confirm before a login discards in-progress guest data (A6).
  const [confirmingLogin, setConfirmingLogin] = useState(false);
  // Two-step confirm before the irreversible account deletion.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Shared pending flag for export/delete so their buttons can disable.
  const [dataBusy, setDataBusy] = useState(false);
  // Forgot-password view + verification-code state (registration OTP / reset).
  const [resetMode, setResetMode] = useState(false);
  const [code, setCode] = useState('');
  const [codeSending, setCodeSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  // Pending flag for the reset submit (resetPassword doesn't go through the
  // authPending-managed submitAuth, so it needs its own double-submit guard).
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  // The modal is never unmounted (isOpen only short-circuits render), so closing
  // it must clear the armed confirms and any in-progress reset — otherwise
  // reopening would let a single click log in (A6) or delete the account,
  // skipping the warning. All closes route through here.
  const handleClose = () => {
    setConfirmingLogin(false);
    setConfirmingDelete(false);
    setResetMode(false);
    setCode('');
    setCodeSent(false);
    onClose?.();
  };

  // Logging in switches to the account's own profile; an unbound guest with
  // progress would otherwise lose it silently. Register binds the current
  // progress, so it never needs this warning.
  const needsLoginConfirm = tab === 'login' && !account?.bound && hasGuestProgress;

  const switchTab = (next) => {
    setTab(next);
    setConfirmingLogin(false);
    setResetMode(false);
    setCode('');
    setCodeSent(false);
    // Clear the password too: its meaning differs across login / register /
    // reset, so a value typed in one context must not bleed into another.
    setPassword('');
  };

  const handleSubmit = async () => {
    if (authPending) return;
    if (!identifier.trim() || !password) {
      notify?.('请输入账号和密码', 'warning', '信息不完整');
      return;
    }

    // First click on a risky login only asks for confirmation; the second
    // (button now relabeled) actually logs in.
    if (needsLoginConfirm && !confirmingLogin) {
      setConfirmingLogin(true);
      return;
    }

    const success = tab === 'register'
      ? await registerAccount(identifier.trim(), password, code.trim() || undefined)
      : await loginAccount(identifier.trim(), password);
    if (success) {
      notify?.(
        tab === 'login' ? '登录成功，已为你同步存档~' : '注册成功，当前进度已绑定到账号~',
        'success',
        tab === 'login' ? '欢迎回来' : '绑定成功'
      );
      setPassword('');
      setConfirmingLogin(false);
      onClose();
    }
  };

  const handleExport = async () => {
    if (dataBusy) return;
    setDataBusy(true);
    const data = await exportUserData?.();
    setDataBusy(false);
    if (data) {
      const ok = downloadJson(data, `xiaoxiai-data-${Date.now()}.json`);
      notify?.(
        ok ? '你的数据已导出为 JSON 文件，请查收下载~' : '数据已生成，但浏览器未能自动下载，请重试。',
        ok ? 'success' : 'warning',
        '数据导出'
      );
    }
  };

  // First click arms the confirm; the second actually deletes. handleClose
  // disarms it so a reopen can't delete on a single click. A FAILED delete
  // intentionally stays armed (the warning stays visible) so the user can just
  // retry — mirroring the login-confirm pattern; only success disarms + closes.
  const handleDelete = async () => {
    if (dataBusy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDataBusy(true);
    const success = await deleteAccount?.();
    setDataBusy(false);
    if (success) {
      notify?.('账号及全部数据已永久删除，已为你切换为新游客。', 'success', '已注销');
      setConfirmingDelete(false);
      onClose?.();
    }
  };

  const handleSendCode = async (purpose) => {
    if (codeSending || authPending) return;
    if (!identifier.trim()) {
      notify?.('请先输入账号', 'warning', '信息不完整');
      return;
    }
    setCodeSending(true);
    const res = await requestAuthCode?.(identifier.trim(), purpose);
    setCodeSending(false);
    if (res) {
      setCodeSent(true);
      notify?.(
        res.devCode ? `验证码已发送（开发模式验证码：${res.devCode}）` : '验证码已发送，请查收。',
        'success',
        '验证码'
      );
    }
  };

  const handleResetPassword = async () => {
    if (submitting) return;
    if (!identifier.trim() || !code.trim() || !password) {
      notify?.('请填写账号、验证码和新密码', 'warning', '信息不完整');
      return;
    }
    setSubmitting(true);
    const success = await resetPassword?.(identifier.trim(), code.trim(), password);
    setSubmitting(false);
    if (success) {
      notify?.('密码已重置，已为你登录~', 'success', '重置成功');
      setPassword('');
      setCode('');
      setResetMode(false);
      onClose?.();
    }
  };

  const tabButtonStyle = (active) => ({
    flex: 1,
    padding: '8px',
    background: active ? 'rgba(255, 117, 151, 0.15)' : '',
    borderColor: active ? 'var(--primary-pink)' : '',
    color: active ? 'var(--text-pink)' : '',
  });

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <div className="modal-title"><span>👤</span><span>账号中心 (Account)</span></div>
          <button className="close-btn" onClick={handleClose}>&times;</button>
        </div>

        {account?.bound ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>💞</div>
            <div style={{ color: 'var(--text-pink)', fontWeight: 600, marginBottom: '6px' }}>
              已绑定账号
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '18px' }}>
              {account.identifier}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '18px' }}>
              你的存档已经和这个账号绑定，换设备登录即可继续陪伴小希。
            </div>
            <button
              className="btn-secondary"
              style={{ width: '100%', padding: '10px' }}
              onClick={() => { logoutAccount?.(); onClose(); }}
            >
              退出登录（切换为新游客）
            </button>

            <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'left' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-pink)', fontWeight: 600, marginBottom: '6px' }}>
                数据与隐私
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
                你可以随时导出自己的全部数据，或永久注销账号。注销会删除你的资料、聊天、记忆、账单等所有记录，且无法恢复。
              </div>
              <button
                className="btn-secondary"
                style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
                onClick={handleExport}
                disabled={dataBusy}
              >
                {dataBusy ? '处理中...' : '导出我的数据（JSON）'}
              </button>
              {confirmingDelete && (
                <div style={{ fontSize: '12px', color: 'var(--accent-gold)', marginBottom: '10px', lineHeight: 1.5 }}>
                  ⚠️ 此操作将永久删除账号「{account.identifier}」及其全部数据，无法恢复。确认注销吗？
                </div>
              )}
              <button
                className="btn-secondary"
                style={{ width: '100%', padding: '10px', color: '#ff6b6b', borderColor: 'rgba(255, 107, 107, 0.5)' }}
                onClick={handleDelete}
                disabled={dataBusy}
              >
                {dataBusy ? '处理中...' : (confirmingDelete ? '确认永久注销账号' : '注销账号')}
              </button>

              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
                <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-pink)' }}>隐私政策</a>
                {' · '}
                <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-pink)' }}>服务条款</a>
              </div>
            </div>
          </div>
        ) : resetMode ? (
          <div>
            <div style={{ fontSize: '13px', color: 'var(--text-pink)', fontWeight: 600, marginBottom: '4px' }}>
              重置密码
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
              输入你的账号获取验证码，验证后即可设置新密码。
            </div>

            <div className="form-field">
              <label>账号（手机号 / 邮箱 / 用户名）</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="例如 xiaoxi@example.com"
                  disabled={codeSending}
                />
                <button
                  className="btn-secondary"
                  style={{ whiteSpace: 'nowrap', padding: '0 12px' }}
                  onClick={() => handleSendCode('reset')}
                  disabled={codeSending}
                >
                  {codeSending ? '发送中...' : (codeSent ? '重新发送' : '发送验证码')}
                </button>
              </div>
            </div>
            <div className="form-field">
              <label>验证码（6 位）</label>
              <input
                className="form-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="请输入收到的验证码"
                disabled={authPending}
              />
            </div>
            <div className="form-field">
              <label>新密码（6-64 位）</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleResetPassword()}
                placeholder="请输入新密码"
                disabled={authPending}
              />
            </div>

            <button
              className="btn-primary"
              style={{ width: '100%', padding: '11px', fontSize: '14px' }}
              onClick={handleResetPassword}
              disabled={submitting}
            >
              {submitting ? '处理中...' : '重置密码并登录'}
            </button>
            <button
              className="btn-secondary"
              style={{ width: '100%', padding: '9px', marginTop: '10px' }}
              onClick={() => switchTab('login')}
            >
              返回登录
            </button>
          </div>
        ) : (
          <div>
            <div className="auth-tab-row">
              <button className="btn-secondary" style={tabButtonStyle(tab === 'login')} onClick={() => switchTab('login')} disabled={authPending}>
                登录
              </button>
              <button className="btn-secondary" style={tabButtonStyle(tab === 'register')} onClick={() => switchTab('register')} disabled={authPending}>
                注册并绑定
              </button>
            </div>

            <div className="form-field">
              <label>账号（手机号 / 邮箱 / 用户名）</label>
              <input
                className="form-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="例如 xiaoxi@example.com"
                disabled={authPending}
              />
            </div>
            <div className="form-field">
              <label>密码（6-64 位）</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="请输入密码"
                disabled={authPending}
              />
            </div>

            {tab === 'register' && requireRegistrationOtp && (
              <div className="form-field">
                <label>验证码（6 位）</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="请输入收到的验证码"
                    disabled={authPending}
                  />
                  <button
                    className="btn-secondary"
                    style={{ whiteSpace: 'nowrap', padding: '0 12px' }}
                    onClick={() => handleSendCode('register')}
                    disabled={codeSending}
                  >
                    {codeSending ? '发送中...' : (codeSent ? '重新发送' : '发送验证码')}
                  </button>
                </div>
              </div>
            )}

            {tab === 'register' && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
                注册会把你当前的游客存档（等级、好感度、爱心币等）绑定到新账号。
                <br />
                注册即表示你已阅读并同意
                <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-pink)' }}>《服务条款》</a>
                与
                <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-pink)' }}>《隐私政策》</a>。
              </div>
            )}

            {needsLoginConfirm && confirmingLogin && (
              <div style={{ fontSize: '12px', color: 'var(--accent-gold)', marginBottom: '12px', lineHeight: 1.5 }}>
                ⚠️ 你当前的游客进度（等级 / 好感度 / 爱心币）不会合并到要登录的账号。如果想保留当前进度，请改用「注册并绑定」。确认登录吗？
              </div>
            )}

            <button
              className="btn-primary"
              style={{ width: '100%', padding: '11px', fontSize: '14px' }}
              onClick={handleSubmit}
              disabled={authPending}
            >
              {authPending
                ? '处理中...'
                : tab === 'register'
                  ? '注册并绑定当前进度'
                  : (needsLoginConfirm && confirmingLogin ? '确认登录（放弃当前进度）' : '登录')}
            </button>

            {tab === 'login' && (
              <button
                className="btn-secondary"
                style={{ width: '100%', padding: '9px', marginTop: '10px', background: 'transparent', borderColor: 'transparent', color: 'var(--text-muted)', fontSize: '12px' }}
                onClick={() => { setResetMode(true); setConfirmingLogin(false); setPassword(''); setCode(''); setCodeSent(false); }}
              >
                忘记密码？
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
