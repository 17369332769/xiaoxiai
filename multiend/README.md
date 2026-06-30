# 小希 AI · 多端版（Taro 4）

把现有 **React 19 + Vite** Web 应用迁移到 **Taro 4**，一套代码发布到 **H5 网站 / 微信小程序 / 支付宝等小程序 / App（React Native）**。

本目录是**非破坏式**的并行工程：不改动仓库根的 `src/`（Web 版）与 `backend/`，并且**直接复用** `shared/`（食物/礼物/任务/主题/关系/剧情目录）与同一套后端 REST API。

---

## 已验证的构建（在本仓库工具链下实测通过）

| 端 | 命令 | 产物 | 状态 |
|---|---|---|---|
| H5 网站 | `npm run build:h5` | `dist/`（index.html + js/css） | ✅ 通过 |
| 微信小程序 | `npm run build:weapp` | `dist/`（app.json + base.wxml + pages） | ✅ 通过 |
| 支付宝小程序 | `taro build --type alipay` | `dist/`（app.acss + base.axml） | ✅ 通过 |
| 抖音/百度/QQ 小程序 | `taro build --type tt\|swan\|qq` | 同上 | 同代码，装对应 `@tarojs/plugin-platform-*` 即可 |
| App（iOS/Android） | Taro React Native（见下「App 路线」） | — | 需 RN 原生工具链，未在本沙箱构建 |

> 三端（H5 / 微信 / 支付宝）均由**同一份 `src/` 代码**编译产出，复用 `@shared` 目录与同一后端。

---

## 快速开始

```bash
cd multiend
npm install
# 首次若报 "Cannot find module '@babel/preset-react'"：
npm i -D @babel/preset-react @babel/preset-env @babel/preset-typescript

# 构建
npm run build:h5      # H5 网站
npm run build:weapp   # 微信小程序（用微信开发者工具打开 dist/）
npm run dev:h5        # H5 watch
npm run dev:weapp     # 微信小程序 watch

# 其它小程序端（先装平台插件，例：支付宝）
npm i -D @tarojs/plugin-platform-alipay
node_modules/.bin/taro build --type alipay
```

后端地址通过编译期环境变量注入（小程序不能用相对 `/api`，必须绝对 HTTPS 域名）：

```bash
TARO_APP_API_BASE="https://api.your-domain.com" npm run build:weapp
```

默认 `http://localhost:3000`（见 `src/config.js`）。

---

## 架构：跨端适配层是关键

Web 代码里**只有三类浏览器 API 不能跨端**，全部收口到 `src/adapters/`，逻辑层因此能近乎零改动地复用：

| 适配器 | 替代的 Web API | 跨端实现 |
|---|---|---|
| `adapters/storage.js` | `localStorage` | `Taro.*StorageSync`（H5/小程序/RN 通用） |
| `adapters/audio.js` | `new Audio()`（TTS 播放） | `Taro.createInnerAudioContext()` |
| `adapters/request.js` | `fetch` + `ReadableStream`（SSE） | `Taro.request`；**流式聊天按端分支**：H5 用 `fetch` 流，小程序用 `Taro.request({ enableChunked })` |

逻辑层移植时只换了这三处 + 几个小修：
- `useTrackedAsync.js`：`AbortController` → 自带极简 shim（小程序 JS 核不保证有 `AbortController`）。
- `useOnlineStatus.js`：`window`/`navigator.onLine` → `Taro.onNetworkStatusChange`。
- `clientLogger.js`：Vite 的 `import.meta.env` → `process.env`（Taro/webpack）。
- `gameStoreHelpers.js`：`getOrCreateUserId` 默认存储 → storage 适配器。

UI 层移植是机械替换：`div→View`、`span→Text`、`button→View+onClick`、`img→Image`、`input→Input(onInput/e.detail.value)`、`onKeyDown 回车→Input onConfirm`、`<canvas> 撒花→跨端 emoji/Text 撒花`。

```
multiend/
├─ config/index.js        # Taro 配置（webpack5；alias @shared → ../../shared）
├─ src/
│  ├─ app.js              # 根组件，挂 LanguageProvider
│  ├─ app.config.js       # 小程序页面清单/导航栏
│  ├─ app.css             # 全局样式（由 web 的 index.css 移植，剔除远程字体 @import，补 page 背景）
│  ├─ config.js           # API_BASE（编译期注入）
│  ├─ adapters/           # storage / audio / request —— 跨端核心
│  ├─ hooks/              # 复用的逻辑层（useGameStore/useGameActions/...）
│  ├─ i18n/  utils/       # 复用
│  ├─ components/         # 13 个组件的 Taro 版
│  └─ pages/index/        # 首页 = 原 App.jsx
└─ src/assets/characters/ # 角色立绘（从 web 复制）
```

---

## App 路线（iOS / Android）

Taro 同一套代码有两条上 App 的路：

1. **Taro React Native（真原生渲染，推荐）**：`npm i -D @tarojs/rn-runner` + RN 依赖，`taro build --type rn`。需要 RN 原生工具链（Xcode / Android SDK / Metro），本沙箱无原生环境故未构建；适配器（storage/audio/request）已按 RN 可用的 Taro API 写好，迁移阻力小。
2. **WebView 套壳（最快）**：把 `build:h5` 产物用 Capacitor 打成 iOS/Android 包。零额外改造，适合先上架验证。

---

## ⚠️ 上线前必须知道（与框架无关，决定成败）

1. **内容合规（最高风险）**：本应用是「AI 情感陪伴/虚拟女友」。**微信/抖音/支付宝小程序对该类目审核极严，很可能无法过审或被下架**。选定小程序端前，请先核对目标平台类目政策——这比技术更优先。
2. **后端必须是正规远程 API**：小程序要求 **HTTPS + 已备案域名**，并在小程序后台配置 **request 合法域名白名单**。把 `TARO_APP_API_BASE` 指向该域名。
3. **TTS 语音**：已通过 `adapters/audio.js` 适配；小程序需确保音频 URL 在合法域名/可达。
4. **视觉保真**：H5 与小程序的 CSS 能力有差异（小程序对 `grid`/`position:fixed`/`var()`/伪元素支持有限）。当前以「双端可构建可运行」为目标，部分弹窗/动画在小程序上的像素级还原需后续微调（详见各组件移植报告中的 residualRisks）。

---

## 状态

- ✅ 工程脚手架 + 工具链（webpack5 编译器，绕开 Vite rolldown 原生绑定坑）
- ✅ 跨端适配层（storage / audio / request 含 SSE 分支）
- ✅ 完整逻辑层移植（useGameStore + 5 hooks + i18n + utils），双端编译通过
- ✅ 13 个 UI 组件 + App 编排页移植，H5 + 微信 + 支付宝三端构建通过
- ✅ 后端契约连通性冒烟（`/api/user/sync` → `200 {ok:true,...}`）
- ⏭️ 待办：小程序端视觉微调；App(RN) 在真机/原生环境出包；其余小程序端按需开启
