const path = require('path');

const config = {
  projectName: 'xiaoxiai-multiend',
  date: '2026-6-30',
  // 375 (not the Taro default 750) because the migrated CSS is hand-tuned in
  // DESKTOP px. On mini-program (pxtransform on), designWidth 750 would halve
  // every size on a 375px phone → microscopic text; 375 maps px ≈ physical px so
  // text stays readable, and the index.css @media breakpoints (1024/768/600)
  // collapse the dashboard to a single mobile column. (H5 has pxtransform off.)
  designWidth: 375,
  deviceRatio: { 375: 2 / 1, 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  terser: {
    config: {
      output: {
        // Keep `0.6` instead of Terser's `.6`; WeChat DevTools' scanner can
        // mistake `cond?.6:1` for optional chaining.
        keep_numbers: true,
      },
    },
  },
  // `@shared` -> the repo-level shared/ catalogs (food/gift/tasks/tiers) so the
  // multi-end app REUSES the same source of truth as web + backend, no fork.
  alias: {
    '@shared': path.resolve(__dirname, '..', '..', 'shared'),
  },
  copy: { patterns: [], options: {} },
  framework: 'react',
  compiler: 'webpack5',
  cache: { enable: false },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    // Dev server (npm run dev:h5): serve on :10086 and proxy /api → backend so
    // the H5 app runs same-origin against the local Express server, no CORS.
    devServer: {
      port: 10086,
      host: '0.0.0.0',
      proxy: {
        '/api': { target: 'http://localhost:3000', changeOrigin: true },
      },
    },
    output: {
      filename: 'js/[name].[hash:8].js',
      chunkFilename: 'js/[name].[chunkhash:8].js',
    },
    miniCssExtractPluginOption: {
      ignoreOrder: true,
      filename: 'css/[name].[hash].css',
      chunkFilename: 'css/[name].[chunkhash].css',
    },
    postcss: {
      // The migrated index.css is hand-tuned DESKTOP px. Taro's default px→rem
      // transform (designWidth 750) + the H5 runtime's flexible root font-size
      // are mobile-canvas scaling that wrecks this layout on desktop. Disable it
      // so px renders as authored — matching the original Vite web app 1:1.
      pxtransform: { enable: false },
      autoprefixer: { enable: true, config: {} },
      cssModules: { enable: false },
    },
  },
};

module.exports = function (merge) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, require('./dev'));
  }
  return merge({}, config, require('./prod'));
};
