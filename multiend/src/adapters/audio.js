// Cross-end audio adapter — replaces `new Audio(url)` (browser-only) used for TTS
// playback. Taro.createInnerAudioContext works on H5 / mini-program / RN. Returns
// a tiny handle mirroring the subset of the HTMLAudioElement API the app relies
// on (play/pause/onEnded/onError/destroy) so the playVoice() logic ports cleanly.
import Taro from '@tarojs/taro';

export function createAudio(src) {
  const ctx = Taro.createInnerAudioContext();
  ctx.src = src;
  let destroyed = false;

  return {
    play() {
      try {
        ctx.play();
      } catch {
        /* ignore — onError handler surfaces real failures */
      }
      // HTMLAudioElement.play() returns a promise the caller may await; mirror it.
      return Promise.resolve();
    },
    pause() {
      try {
        ctx.pause();
      } catch {
        /* ignore */
      }
    },
    onEnded(cb) {
      ctx.onEnded(cb);
    },
    onError(cb) {
      ctx.onError(cb);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        ctx.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}
