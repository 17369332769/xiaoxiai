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
│  ├─ server.js          # API 入口
│  ├─ db.js              # SQLite 初始化与封装
│  ├─ memoryEngine.js    # 记忆整理任务
│  └─ database.sqlite    # 本地数据库
├─ vite.config.js        # 前端开发代理配置
└─ 需求分析文档.md        # 当前产品需求与迭代建议
```

## 技术栈

- 前端：`React 19`、`Vite`
- 后端：`Node.js`、`Express`
- 数据库：`SQLite`
- 大模型接入：兼容 OpenAI SDK 的接口配置

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
Copy-Item backend/.env.example backend/.env
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
- `PRESENCE_BASELINE`：在真实在线人数基础上叠加的展示基数，默认 `0`
- `PAYMENT_SECRET`：支付回调签名密钥（HMAC），生产必须覆盖
- `AUTH_SECRET`：账号登录令牌签名密钥（HMAC），生产必须覆盖
- `ADMIN_TOKEN`：运营后台令牌；留空则完全禁用后台（`/admin.html` 与 `/api/admin/*`）
- `OPENAI_API_KEY`：模型服务 API Key
- `OPENAI_API_BASE_URL`：兼容 OpenAI SDK 的接口地址
- `OPENAI_MODEL_NAME`：模型名称，例如 `gpt-4o-mini` 或 `deepseek-chat`

如果不配置 `OPENAI_API_KEY`，系统会退回到本地规则回复模式。

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

前端通过 [vite.config.js](D:/project/xiaoxiai/vite.config.js) 将 `/api` 请求代理到 `http://localhost:3000`。

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

## 主要接口

- `POST /api/user/sync`：同步用户资料、任务、聊天记录、账号绑定状态
- `POST /api/chat`：发送聊天消息并获取 AI 回复
- `POST /api/checkin`：每日签到（含连续签到奖励）
- `POST /api/task/claim`：领取任务奖励
- `POST /api/action/feed`：喂食小希
- `POST /api/action/gift`：赠送礼物
- `POST /api/action/tip`：即时模拟打赏（内部创建并结算真实订单）
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

详细接口说明见 [API.md](D:/project/xiaoxiai/backend/API.md)
运维与安全说明见 [OPERATIONS.md](D:/project/xiaoxiai/backend/OPERATIONS.md)

## 数据说明

SQLite 文件位置：

- [database.sqlite](D:/project/xiaoxiai/backend/database.sqlite)

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

## 后续建议

- 补接口文档与错误码约定
- 增加统一错误提示和请求重试机制
- 增加限流、输入过滤与内容安全策略
- 接入真实订单与支付回调体系
- 增加测试覆盖和发布前检查流程
