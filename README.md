# 小希 AI 温柔女友版

一个基于 `React + Vite + Express + SQLite` 的 AI 陪伴网页应用。

当前版本已经具备一个较完整的产品闭环：

- 匿名用户自动创建与本地身份持久化
- 正式账号体系（注册 / 登录 / 游客绑定 / 跨设备同步）
- AI 对话与聊天记录保存（含人设深化、时段/节日问候、低状态剧情约束、前端打字机效果）
- 好感度、等级、体力、心情成长系统
- 每日签到（连续签到奖励）与每日任务 + 成长成就任务
- 喂食、送礼互动，以及真实订单支付闭环（下单 → 回调验签 → 幂等发币 → 查询 → 退款）
- 长期记忆摘要与用户事实提炼，支持记忆上限/优先级与人工清理
- 真实在线人数与真实广播（事件驱动 + 运营公告）
- 行为埋点与数据化运营指标（DAU / 留存 / 付费转化 / ARPPU）
- 运营后台（`/admin.html`：指标、用户、订单退款、公告管理）
- 内容安全过滤、统一错误返回、限流、密钥管理

## 项目结构

```text
xiaoxiai/
├─ src/                  # 前端 React 页面与状态逻辑
├─ public/               # 静态资源
├─ backend/              # Express + SQLite 后端
│  ├─ server.js          # 启动入口
│  ├─ app.js             # Express 应用组装（挂载中间件 + 注册各路由）
│  ├─ routes/            # HTTP 端点注册（apiRoutes / accountRoutes / themeRoutes 等）
│  ├─ services/          # 领域/业务逻辑（含 ai/、memory/ 子域）
│  ├─ core/              # 跨切面基础设施（db / logger / middleware / httpUtils / 鉴权）
│  ├─ config/            # 后端运行时配置（gameConfig）
│  ├─ skills/            # 模型可调用的工具技能（联网搜索 / 天气 / 记忆等）
│  ├─ tests/             # 后端测试（node --test）
│  └─ database.sqlite    # 本地运行时生成的数据库文件（默认不提交）
├─ shared/               # 前后端共享配置（gameConfig / memoryLabels）
├─ vite.config.js        # 前端开发代理配置
└─ 需求分析文档.md        # 当前产品需求与迭代建议
```

## 技术栈

- 前端：`React 19`、`Vite`
- 后端：`Node.js`、`Express`
- 数据库：`SQLite`
- 大模型接入：兼容 OpenAI SDK 的接口配置
- 联网搜索：可选接入博查（Bocha）Web Search，模型按需调用 `web_search` 工具

## 本地启动

### 1. 安装依赖

前端：

```powershell
npm install
```

后端：

```powershell
cd backend
npm install
```

### 2. 配置环境变量

后端使用 `backend/.env`。

可以先参考示例文件：

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

```bash
# Linux / macOS
cp backend/.env.example backend/.env
```

可用变量：

- `PORT`：后端端口，默认 `3000`
- `ALLOWED_ORIGIN`：允许访问后端的前端来源，默认 `http://localhost:5173`
- `RATE_LIMIT_WINDOW_MS`：限流窗口，默认 `60000`
- `RATE_LIMIT_MAX_REQUESTS`：每个 IP 在窗口内允许的请求数，默认 `60`
- `LOG_LEVEL`：后端日志级别，默认 `info`
- `LOG_REQUESTS`：是否打印请求日志，默认 `true`
- `XIAOXIAI_DB_PATH`：自定义 SQLite 文件路径
- `EXTRA_BLOCKED_WORDS`：聊天内容安全过滤的额外屏蔽词（逗号分隔），追加到内置词表
- `MEMORY_CAP`：每个用户长期记忆条数上限，默认 `20`；超出后按权重和时间淘汰
- `MEMORY_TTL_DAYS`：长期记忆失效天数，默认 `0`（关闭）；>0 时清理超期且低权重（未被反复提及）的陈旧记忆
- `PRESENCE_BASELINE`：在真实在线人数基础上叠加的展示基数，默认 `0`
- `PAYMENT_SECRET`：支付回调签名密钥（HMAC），生产必须覆盖
- `AUTH_SECRET`：账号登录令牌签名密钥（HMAC），生产必须覆盖
- `ADMIN_TOKEN`：运营后台令牌；留空则完全禁用后台（`/admin.html` 与 `/api/admin/*`）
- `ALLOW_SIMULATED_PAYMENT`：仅演示用开关，默认 `false`。为 `true` 时 `/api/action/tip` 不经真实支付即时发币、且 `/api/order/create` 会下发可被客户端回放的已签名回调；**生产必须保持 `false`/不设**，否则等于开放免费刷币
- `OPENAI_API_KEY`：模型服务 API Key
- `OPENAI_API_BASE_URL`：兼容 OpenAI SDK 的接口地址
- `OPENAI_MODEL_NAME`：模型名称，例如 `gpt-4o-mini` 或 `deepseek-chat`
- `BOCHA_API_KEY`：博查联网搜索密钥（可选）；留空则关闭联网搜索

如果不配置 `OPENAI_API_KEY`，系统会退回到本地规则回复模式。
配置 `BOCHA_API_KEY` 后，模型会在遇到天气、新闻、价格、近期事件等实时/事实性问题时自动联网搜索，日常情感闲聊不触发。

### 3. 启动后端

```powershell
cd backend
npm run dev
```

默认启动在 `http://localhost:3000`

### 4. 启动前端

新开一个终端，在项目根目录执行：

```powershell
npm run dev
```

默认启动在 `http://localhost:5173`

前端通过 [vite.config.js](vite.config.js) 将 `/api` 请求代理到 `http://localhost:3000`。

## 常用命令

根目录：

```powershell
npm run dev
npm run build
npm run lint
npm run check:secrets
npm run verify
```

后端目录：

```powershell
npm run dev
npm start
```

## 部署（生产）

生产环境分为静态前端与后端 API 两部分：

1. 构建前端：`npm run build` 生成 `dist/`（含运营后台页 `admin.html`），由 Nginx 或任意静态服务器托管。
2. 运行后端：`cd backend && npm start`，建议用 pm2 或 systemd 守护。后端只提供 `/api/*`，默认监听 `127.0.0.1:3000`。
3. 用 Nginx 反向代理：静态托管 `dist/`，把 `/api` 代理到后端。`admin.html` 已随构建进入 `dist/`，作为静态文件提供即可。
4. 生产必须覆盖的环境变量：`AUTH_SECRET`、`PAYMENT_SECRET`、`ADMIN_TOKEN`、`ALLOWED_ORIGIN`（指向前端真实域名）；并确保 `ALLOW_SIMULATED_PAYMENT` 保持 `false`/不设（否则客户端可免费刷币）；`backend/.env` 不入库。

完整的 pm2 / systemd / Nginx 配置示例与数据库备份建议见 [OPERATIONS.md](backend/OPERATIONS.md) 的「Production Deployment」章节。

## 主要接口

- `POST /api/user/sync`：同步用户资料、任务、聊天记录、账号绑定状态
- `POST /api/chat`：发送聊天消息并获取 AI 回复
- `POST /api/checkin`：每日签到（含连续签到奖励）
- `POST /api/task/claim`：领取任务奖励
- `POST /api/action/feed`：喂食小希
- `POST /api/action/gift`：赠送礼物
- `POST /api/action/tip`：即时模拟打赏（仅 `ALLOW_SIMULATED_PAYMENT=true` 时即时发币，否则返回 `403`，请改走下方正式支付流程）
- `POST /api/transactions`：查询爱心币流水（消费记录 / 钱包账单）
- `POST /api/order/create`、`POST /api/payment/callback`、`POST /api/order/query`：真实支付下单 / 回调验签 / 订单查询
- `POST /api/auth/register`、`/api/auth/login`、`/api/auth/bind`：账号注册 / 登录 / 绑定
- `POST /api/presence`、`POST /api/broadcasts`：真实在线人数与广播
- `POST /api/memory/list`、`/api/memory/delete`、`/api/memory/clear`：长期记忆查看与清理
- `POST /api/analytics/track`：前端行为埋点
- `POST /api/admin/*`：运营后台接口（需 `x-admin-token`）

统一返回约定：

- 成功：`{ ok: true, ...data }`
- 失败：`{ ok: false, error: { code, message } }`

详细接口说明见 [API.md](backend/API.md)
运维与安全说明见 [OPERATIONS.md](backend/OPERATIONS.md)

## 数据说明

SQLite 文件位置：

- 默认运行时路径为 `backend/database.sqlite`
- 也可以通过 `XIAOXIAI_DB_PATH` 指向自定义位置
- 该文件属于本地/部署环境数据文件，默认不提交到仓库

当前表结构包括：

- `users`
- `chat_messages`
- `tasks`
- `user_memories`
- `transactions`
- `orders`
- `events`
- `broadcasts`
- `accounts`

## 当前实现说明

- 支付已实现完整订单闭环（下单 / 回调验签 / 幂等发币 / 查询 / 退款）。受限于演示环境没有真实支付商户，回调由“模拟网关”发起并以 `PAYMENT_SECRET` 进行 HMAC 验签——业务流程是真实的，缺的只是接入真实微信/支付宝商户号。
- 在线人数为基于心跳的真实统计（可叠加 `PRESENCE_BASELINE` 展示基数）；广播由真实事件（打赏/充值、戒指送礼、升级）与运营公告驱动。
- 记忆整理依赖外部大模型；未配置 API Key 时不会执行真实记忆提炼，但记忆的上限/优先级与人工清理（查看/删除）始终可用。
- 每日任务按天重置；成长成就任务长期累计不重置。
- 运营后台位于 `/admin.html`，需要配置 `ADMIN_TOKEN` 才会启用。
- 鉴权模型：登录/注册签发的 HMAC 令牌现在会被业务接口校验（前端自动在 `Authorization: Bearer` 头携带）。一旦游客身份绑定了正式账号，该 `userId` 只能凭有效令牌操作，不能再仅凭请求体里的 `userId` 访问（防止越权接管）；未绑定的纯游客身份仍可无令牌游玩。

## 安全提醒

- `backend/.env` 不应该提交真实密钥。
- 如果仓库里已经出现真实 `OPENAI_API_KEY`，建议立即到对应平台执行密钥轮换。
- 建议后续把 `backend/.env` 改为仅本地使用，并移出版本控制。
- 项目现在提供 `npm run check:secrets`，会检查 `backend/.env` 这类敏感文件是否仍被 Git 跟踪。

## 验证建议

发布前推荐直接运行一条完整检查：

```powershell
npm run verify
```

它会依次执行：

- `npm run check:secrets`
- `npm run lint`
- `npm test`
- `npm --prefix backend test`
- `npm run build`

## 后续路线

近期已完成一轮安全 / 可靠性 / 运维加固（鉴权强制、免费刷币堵漏、SQLite WAL+busy_timeout、登录防爆破、令牌过期、`trust proxy`、聊天记录保留上限、`/api/health` 健康检查、管理操作审计、GitHub Actions CI 等，均有测试覆盖）。逐项进度与结论见 [IMPROVEMENT_LEDGER.md](IMPROVEMENT_LEDGER.md)。

已交付（本轮，均有测试 + `npm run verify` 全绿）：

- 服务端流式 SSE、语音 TTS（海螺 ~1s）+ 浏览器 STT
- 令牌服务端吊销/刷新（`/api/auth/logout`、`/api/auth/refresh`）；登录二级标识锁（防换 IP 绕过）；前端登录态自动续期（每 12h，长开页面不掉登录）
- 记忆主动添加/编辑（`/api/memory/add`、`/api/memory/update`）
- 后台可写配置（`/api/admin/config` 改商品/打赏价**及任务奖励**即时生效，无需重部署）
- 用户数据导出 / 账号注销（`/api/user/export`、`/api/user/delete`）——含前端入口（账号中心「数据与隐私」：导出 JSON / 二步确认注销）
- SQLite 自动备份（`VACUUM INTO` + 保留轮换）
- 隐私政策 / 服务条款示例模板（`public/privacy.html`、`public/terms.html`）+ 前端入口（页脚 / 注册同意提示 / 账号中心「数据与隐私」）——内容贴合实际数据实践，**上线前需法务审核**
- 注册验证码（OTP，`REQUIRE_REGISTRATION_OTP` 门控默认关）+ 密码找回（忘记密码 → 验证码 → 重置并登录，重置即吊销旧会话）；验证码发送为服务端日志开发桩，接真实短信/邮件见 `backend/verification.js`
- 形象换装 · 主题换肤（爱心币解锁 + 一键切换 5 套主题，运行时改 CSS 变量重塑配色，服务端持久化跨设备同步）：`/api/themes`、`/api/themes/unlock`、`/api/themes/equip`，入口在「形象换装」
- 主动召回 · 回归问候（离开超过 `RECALL_MIN_AWAY_HOURS`（默认 6h）后再回来，小希在对话里主动发分级"想你了 / 好久不见"问候，纯服务端注入）

待办（多数需产品 / 基建决策或外部资源）：

- 合规基线：实名认证 + 青少年模式 + 第三方内容审核 API（隐私政策 / ToS 已出示例模板，需法务审核后启用）
- 接入真实微信 / 支付宝商户号（当前为模拟网关，业务流程已就绪）；海螺克隆音色（需样本）
- 体验增强：玩法剧情深化、会员订阅（形象换装·主题换肤、主动召回·回归问候已交付，见上）
- 运营与可观测性：指标 / Sentry 接入、会员订阅等付费结构；多实例共享节流存储
