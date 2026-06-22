import * as React from 'react';

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
  notify,
}) {
  const [tab, setTab] = useState('login'); // 'login' or 'register'
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // Two-step confirm before a login discards in-progress guest data (A6).
  const [confirmingLogin, setConfirmingLogin] = useState(false);

  if (!isOpen) return null;

  // The modal is never unmounted (isOpen only short-circuits render), so closing
  // it must clear the armed confirm — otherwise reopening would let a single
  // click log in and skip the warning. All closes route through here.
  const handleClose = () => {
    setConfirmingLogin(false);
    onClose?.();
  };

  // Logging in switches to the account's own profile; an unbound guest with
  // progress would otherwise lose it silently. Register binds the current
  // progress, so it never needs this warning.
  const needsLoginConfirm = tab === 'login' && !account?.bound && hasGuestProgress;

  const switchTab = (next) => {
    setTab(next);
    setConfirmingLogin(false);
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

    const action = tab === 'login' ? loginAccount : registerAccount;
    const success = await action(identifier.trim(), password);
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

            {tab === 'register' && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                注册会把你当前的游客存档（等级、好感度、爱心币等）绑定到新账号。
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
          </div>
        )}
      </div>
    </div>
  );
}
