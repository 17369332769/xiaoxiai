import * as React from 'react';
import { useT } from '../i18n/index.js';

const { useState } = React;

export default function ThemeModal({
  isOpen,
  onClose,
  themes = [],
  ownedThemes = [],
  equippedTheme,
  coins = 0,
  unlockTheme,
  equipTheme,
  notify,
}) {
  const t = useT();
  const [busyId, setBusyId] = useState(null);

  if (!isOpen) return null;

  const isOwned = (id) => ownedThemes.includes(id);

  const handleEquip = async (theme) => {
    if (busyId) return;
    setBusyId(theme.id);
    const ok = await equipTheme?.(theme.id);
    setBusyId(null);
    if (ok) notify?.(t('theme.equipSuccess', { name: theme.name }), 'success', t('theme.equipSuccessTitle'));
  };

  const handleUnlock = async (theme) => {
    if (busyId) return;
    if (coins < theme.cost) {
      notify?.(t('theme.insufficient'), 'warning', t('theme.insufficientTitle'));
      return;
    }
    setBusyId(theme.id);
    const ok = await unlockTheme?.(theme.id);
    setBusyId(null);
    if (ok) notify?.(t('theme.unlockSuccess', { name: theme.name }), 'success', t('theme.unlockSuccessTitle'));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div className="modal-header">
          <div className="modal-title"><span>🎀</span><span>{t('theme.title')}</span></div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          {t('theme.intro')}
          <span style={{ color: 'var(--accent-gold)', marginLeft: '6px' }}>{t('theme.balance', { coins })}</span>
        </div>

        <div style={{ display: 'grid', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
          {themes.map((theme) => {
            const owned = isOwned(theme.id);
            const equipped = theme.id === equippedTheme;
            const busy = busyId === theme.id;
            return (
              <div
                key={theme.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px',
                  borderRadius: '12px',
                  border: `1px solid ${equipped ? 'var(--primary-pink)' : 'var(--panel-border)'}`,
                  background: 'var(--panel-bg-light)',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: '46px', height: '46px', borderRadius: '10px', flexShrink: 0,
                    background: theme.vars['--bg-gradient'],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `0 0 0 2px ${theme.vars['--primary-pink']} inset`,
                    fontSize: '20px',
                  }}
                >
                  {theme.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-pink)', fontWeight: 600, fontSize: '14px' }}>{theme.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{theme.desc}</div>
                </div>
                {equipped ? (
                  <span style={{ fontSize: '12px', color: 'var(--primary-pink)', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('theme.inUse')}</span>
                ) : owned ? (
                  <button
                    className="btn-secondary"
                    style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}
                    onClick={() => handleEquip(theme)}
                    disabled={busy}
                  >
                    {busy ? '...' : t('theme.equip')}
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}
                    onClick={() => handleUnlock(theme)}
                    disabled={busy}
                  >
                    {busy ? '...' : t('theme.unlock', { cost: theme.cost })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
