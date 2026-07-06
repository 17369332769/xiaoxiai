const DEFAULT_REMOTE_ASSET_BASE =
  'https://pub-b8fa87e80196442f84d5cad6701152f3.r2.dev';

const configuredAssetBase =
  (typeof process !== 'undefined' && process.env && process.env.TARO_APP_ASSET_BASE) ||
  DEFAULT_REMOTE_ASSET_BASE;

const ASSET_BASE = configuredAssetBase.replace(/\/+$/, '');

const characterImage = (skin, fileName) => `${ASSET_BASE}/characters/${skin}-${fileName}`;

export const CHARACTER_ASSETS = {
  xiaoxi: {
    normal: characterImage('xiaoxi', 'normal.jpg'),
    happy: characterImage('xiaoxi', 'happy.jpg'),
    blush: characterImage('xiaoxi', 'blush.jpg'),
    angry: characterImage('xiaoxi', 'angry.png'),
    sad: characterImage('xiaoxi', 'sad.png'),
    wink: characterImage('xiaoxi', 'wink.png'),
  },
  xiaoya: {
    normal: characterImage('xiaoya', 'normal.png'),
    happy: characterImage('xiaoya', 'happy.png'),
    blush: characterImage('xiaoya', 'blush.png'),
    angry: characterImage('xiaoya', 'angry.png'),
    sad: characterImage('xiaoya', 'sad.png'),
    wink: characterImage('xiaoya', 'wink.png'),
  },
};
