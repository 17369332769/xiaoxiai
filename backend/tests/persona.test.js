import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPersonaContext,
  getFestivalNote,
  getStateConstrainedReply,
  getStateNote,
  getTimeGreeting,
} from '../services/personaEngine.js';

test('getStateConstrainedReply nudges care only when energy/mood are critically low', () => {
  // Healthy stats → no forced reply (the model/local engine answers normally).
  assert.equal(getStateConstrainedReply({ energy: 80, mood: 70 }), null);

  // Low energy → tired reply that hints at feeding, and grants no affection.
  const tired = getStateConstrainedReply({ energy: 10, mood: 70 });
  assert.ok(tired);
  assert.equal(tired.affection_bump, 0);
  assert.match(tired.reply, /体力|补充|喂/);

  // Low mood (energy fine) → comfort-seeking reply.
  const lowMood = getStateConstrainedReply({ energy: 80, mood: 15 });
  assert.ok(lowMood);
  assert.match(lowMood.reply, /心情|安慰|礼物/);

  // Both critically low → the combined state, still zero affection.
  const both = getStateConstrainedReply({ energy: 10, mood: 20 });
  assert.ok(both);
  assert.equal(both.affection_bump, 0);
});

test('getStateNote mirrors the constrained-reply thresholds for the prompt', () => {
  assert.equal(getStateNote({ energy: 80, mood: 70 }), null);
  assert.ok(getStateNote({ energy: 10, mood: 70 }));
  assert.ok(getStateNote({ energy: 80, mood: 15 }));
});

test('getTimeGreeting returns a slot appropriate to the hour', () => {
  assert.equal(getTimeGreeting(new Date(2026, 5, 22, 2, 0)).slot, 'late_night');
  assert.equal(getTimeGreeting(new Date(2026, 5, 22, 7, 0)).slot, 'morning');
  assert.equal(getTimeGreeting(new Date(2026, 5, 22, 13, 0)).slot, 'noon');
  assert.equal(getTimeGreeting(new Date(2026, 5, 22, 20, 0)).slot, 'evening');
});

test('getFestivalNote recognizes a solar-calendar festival and ignores ordinary days', () => {
  assert.ok(getFestivalNote(new Date(2026, 11, 25))); // 12-25 圣诞
  assert.ok(getFestivalNote(new Date(2026, 1, 14)));  // 02-14 情人节
  assert.equal(getFestivalNote(new Date(2026, 2, 3)), null); // 03-03 ordinary day
});

test('buildPersonaContext composes the relationship tier, greeting and login-streak hint', () => {
  const ctx = buildPersonaContext(
    { level: 10, login_streak: 3, energy: 80, mood: 70 },
    new Date(2026, 5, 22, 8, 0)
  );
  assert.equal(ctx.tier.title, '甜蜜恋人'); // level 10 tier
  assert.equal(ctx.address, ctx.tier.address);
  assert.match(ctx.promptBlock, /连续 3 天/);
  assert.match(ctx.promptBlock, /甜蜜恋人/);
});
