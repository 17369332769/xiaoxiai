// Taro preset drives JSX + platform transforms. framework=react, no TS (plain JSX).
module.exports = {
  presets: [
    ['taro', { framework: 'react', ts: false, compiler: 'webpack5' }],
  ],
  plugins: [
    '@babel/plugin-transform-nullish-coalescing-operator',
    '@babel/plugin-transform-optional-chaining',
  ],
};
