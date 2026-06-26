import * as React from 'react';

const { useState } = React;

// 恋爱剧情 picker. Lists episodes (locked / unread / read) gated by the user's
// relationship level, and plays a selected episode scene-by-scene like an
// interactive visual novel: narration, 小希's lines, and player choices. Picking a
// choice reveals 小希's reaction and is collected; finishing an unread episode claims
// its one-time reward (coins + the affection earned from the choices). The backend
// is idempotent, so re-reading a finished episode grants nothing again.
export default function StoryModal({
  isOpen,
  onClose,
  stories = [],
  readStories = [],
  level = 1,
  claimStory,
  notify,
}) {
  const [reading, setReading] = useState(null); // the episode currently being read
  const [sceneIdx, setSceneIdx] = useState(0);
  const [choices, setChoices] = useState({});   // sceneIdx -> chosen option index
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const isRead = (id) => readStories.includes(id);

  const openEpisode = (story) => {
    setReading(story);
    setSceneIdx(0);
    setChoices({});
  };

  const closeReader = () => {
    setReading(null);
    setSceneIdx(0);
    setChoices({});
  };

  const finishReading = async (story) => {
    if (busy) return;
    setBusy(true);
    const picks = Object.entries(choices).map(([scene, option]) => ({ scene: Number(scene), option }));
    const result = await claimStory?.(story.id, picks);
    setBusy(false);
    // On failure (null) the store already notified; keep the reader open so the user
    // can retry "读完啦" rather than losing their place.
    if (!result) return;
    if (result.rewarded) {
      const r = result.reward || {};
      const parts = [];
      if (r.coins) parts.push(`${r.coins} 爱心币`);
      if (r.affection) parts.push(`好感 +${r.affection}`);
      notify?.(`读完《${story.title}》${parts.length ? `，获得 ${parts.join('、')}` : ''}！`, 'success', '剧情完成');
    }
    closeReader();
  };

  // --- Reader view: play the selected episode one scene at a time. ---
  if (reading) {
    const scenes = reading.scenes || [];
    const scene = scenes[sceneIdx] || { who: 'narration', text: '' };
    const isLast = sceneIdx >= scenes.length - 1;
    const isChoice = scene.who === 'choice';
    const pickedIdx = isChoice ? choices[sceneIdx] : undefined;
    const chosenOption = (isChoice && pickedIdx != null && scene.options) ? scene.options[pickedIdx] : null;
    const isXiaoxi = scene.who === 'xiaoxi';
    const canAdvance = !isChoice || Boolean(chosenOption); // a choice must be answered first

    const xiaoxiLine = (text) => (
      <>
        <div style={{ color: 'var(--primary-pink)', fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>小希</div>
        <div style={{ color: 'var(--text-pink)', fontSize: '15px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{text}</div>
      </>
    );
    const narrationLine = (text) => (
      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '15px', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{text}</div>
    );

    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
          <div className="modal-header">
            <div className="modal-title"><span>{reading.icon}</span><span>{reading.title}</span></div>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
            第 {sceneIdx + 1} / {scenes.length} 幕
          </div>

          <div
            style={{
              minHeight: '160px', display: 'flex', flexDirection: 'column',
              justifyContent: 'center', padding: '18px', borderRadius: '12px',
              border: '1px solid var(--panel-border)', background: 'var(--panel-bg-light)',
              marginBottom: '14px',
            }}
          >
            {isChoice ? (
              <>
                {narrationLine(scene.text)}
                {chosenOption && (
                  <div style={{ marginTop: '14px' }}>{xiaoxiLine(chosenOption.reply)}</div>
                )}
              </>
            ) : isXiaoxi ? xiaoxiLine(scene.text) : narrationLine(scene.text)}
          </div>

          {/* Unanswered choice: present the options and require a pick to continue. */}
          {isChoice && !chosenOption && (
            <div style={{ display: 'grid', gap: '8px', marginBottom: '14px' }}>
              {(scene.options || []).map((opt, i) => (
                <button
                  key={i}
                  className="btn-secondary"
                  style={{ textAlign: 'left', padding: '10px 14px', whiteSpace: 'normal', lineHeight: 1.5 }}
                  onClick={() => setChoices((prev) => ({ ...prev, [sceneIdx]: i }))}
                >
                  {opt.text}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
            <button
              className="btn-secondary"
              style={{ padding: '8px 16px' }}
              onClick={() => setSceneIdx((i) => Math.max(0, i - 1))}
              disabled={sceneIdx === 0}
            >
              上一句
            </button>
            {canAdvance && (isLast ? (
              <button className="btn-primary" style={{ padding: '8px 16px' }} onClick={() => finishReading(reading)} disabled={busy}>
                {busy ? '...' : (isRead(reading.id) ? '读完啦' : '读完啦 · 领取心意')}
              </button>
            ) : (
              <button className="btn-primary" style={{ padding: '8px 16px' }} onClick={() => setSceneIdx((i) => i + 1)}>
                下一句
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- List view: every episode with its locked / unread / read state. ---
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div className="modal-header">
          <div className="modal-title"><span>📖</span><span>恋爱剧情 (Story)</span></div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          随着羁绊加深，解锁你和小希的专属剧情。读剧情时你的选择会影响小希的反应与好感，读完还能领一次心意奖励哦~
          <span style={{ color: 'var(--accent-gold)', marginLeft: '6px' }}>当前羁绊 Lv.{level}</span>
        </div>

        <div style={{ display: 'grid', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
          {stories.map((story) => {
            const unlocked = level >= story.requiredLevel;
            const read = isRead(story.id);
            return (
              <div
                key={story.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px',
                  borderRadius: '12px',
                  border: `1px solid ${read ? 'var(--primary-pink)' : 'var(--panel-border)'}`,
                  background: 'var(--panel-bg-light)',
                  opacity: unlocked ? 1 : 0.6,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: '46px', height: '46px', borderRadius: '10px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--panel-bg)', fontSize: '22px',
                  }}
                >
                  {unlocked ? story.icon : '🔒'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-pink)', fontWeight: 600, fontSize: '14px' }}>
                    {story.title}{read ? ' ✓' : ''}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    {unlocked ? story.summary : `羁绊达到 Lv.${story.requiredLevel} 解锁`}
                  </div>
                </div>
                {!unlocked ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Lv.{story.requiredLevel}
                  </span>
                ) : (
                  <button
                    className={read ? 'btn-secondary' : 'btn-primary'}
                    style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}
                    onClick={() => openEpisode(story)}
                  >
                    {read ? '重温' : '阅读'}
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
