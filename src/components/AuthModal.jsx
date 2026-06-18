import { useState } from 'react';

export default function AuthModal({
  isOpen,
  onClose,
  account,
  authPending = false,
  registerAccount,
  loginAccount,
  logoutAccount,
  notify,
}) {
  const [tab, setTab] = useState('login'); // 'login' or 'register'
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (authPending) return;
    if (!identifier.trim() || !password) {
      notify?.('请输入账号和密码', 'warning', '信息不完整');
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <div className="modal-title"><span>👤</span><span>账号中心 (Account)</span></div>
          <button className="close-btn" onClick={onClose}>&times;</button>
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
              <button className="btn-secondary" style={tabButtonStyle(tab === 'login')} onClick={() => setTab('login')} disabled={authPending}>
                登录
              </button>
              <button className="btn-secondary" style={tabButtonStyle(tab === 'register')} onClick={() => setTab('register')} disabled={authPending}>
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

            <button
              className="btn-primary"
              style={{ width: '100%', padding: '11px', fontSize: '14px' }}
              onClick={handleSubmit}
              disabled={authPending}
            >
              {authPending ? '处理中...' : (tab === 'login' ? '登录' : '注册并绑定当前进度')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
