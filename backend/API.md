# Backend API Reference

后端默认基地址：

```text
http://localhost:3000
```

业务接口均为 `POST`，请求体为 JSON。唯一例外是健康检查：

## GET /api/health

负载均衡 / 探活用。检查数据库连通性，无需鉴权，且不计入限流。

- 正常：`200 { "ok": true, "db": "up" }`
- 数据库不可用：`503 { "ok": false, "db": "down" }`

## Authentication（鉴权）

业务接口（`/api/user`、`/api/chat`、`/api/action/*`、`/api/task`、`/api/checkin`、`/api/transactions`、`/api/order/*`、`/api/memory/*`、`/api/analytics/track`、`/api/presence`）通过中间件解析请求用户：

- 携带 `Authorization: Bearer <token>`（来自 `/api/auth/login`、`/api/auth/register`）时，以令牌中的 `userId` 为准，忽略请求体的 `userId`。
- 未携带（或令牌失效）时，回退到请求体 `userId`；若该 `userId` 已绑定正式账号，返回 `401 AUTH_REQUIRED`（必须登录）；未绑定的游客身份照常放行。

不需要鉴权的公开/特殊接口：`/api/auth/*`、`/api/payment/callback`（由支付网关以 HMAC 签名认证）、`/api/broadcasts`（只读公开 feed）、`/api/admin/*`（改用 `x-admin-token`）。

## Response Contract

成功：

```json
{
  "ok": true
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Readable error message"
  }
}
```

## Common Error Codes

| code | meaning |
| --- | --- |
| `INVALID_JSON` | 请求体不是合法 JSON |
| `INVALID_USER_ID` | `userId` 缺失或格式不合法 |
| `AUTH_REQUIRED` | 该身份已绑定账号，但未提供有效令牌 |
| `TIP_SIMULATION_DISABLED` | 即时模拟打赏已停用（`ALLOW_SIMULATED_PAYMENT` 未开启），请走正式支付 |
| `INVALID_TEXT` | 聊天文本为空或缺失 |
| `TEXT_TOO_LONG` | 聊天文本超过 500 字符 |
| `CONTENT_BLOCKED` | 聊天文本命中内容安全过滤 |
| `INVALID_PARAMETER` | 商品 ID、任务 ID、支付方式等参数不合法 |
| `USER_NOT_FOUND` | 用户不存在 |
| `RESOURCE_NOT_FOUND` | 用户或任务等资源不存在 |
| `INSUFFICIENT_COINS` | 爱心币不足 |
| `TASK_NOT_CLAIMABLE` | 任务未完成或已领取 |
| `ALREADY_CHECKED_IN` | 当天已签到 |
| `INVALID_TIP_TIER` | 打赏/充值档位不合法 |
| `FORBIDDEN_ORIGIN` | 请求来源不在允许列表内 |
| `RATE_LIMITED` | 请求频率过高 |
| `INVALID_SIGNATURE` | 支付回调签名验证失败 |
| `AMOUNT_MISMATCH` | 支付回调金额与订单不一致 |
| `ORDER_NOT_FOUND` | 订单不存在或不属于该用户 |
| `ORDER_NOT_REFUNDABLE` | 订单当前状态不可退款 |
| `INVALID_CREDENTIALS` | 账号或密码缺失 |
| `INVALID_IDENTIFIER` | 账号标识（手机号/邮箱/用户名）不合法 |
| `INVALID_PASSWORD` | 密码长度不合法（6-64 位） |
| `ACCOUNT_EXISTS` | 账号标识已被注册 |
| `USER_ALREADY_BOUND` | 当前游客身份已绑定账号 |
| `INVALID_LOGIN` | 账号或密码不正确 |
| `TOO_MANY_ATTEMPTS` | 登录失败次数过多，已临时锁定 |
| `MEMORY_NOT_FOUND` | 指定记忆不存在 |
| `INVALID_EVENT` | 埋点事件类型不在白名单内 |
| `ADMIN_DISABLED` | 未配置 `ADMIN_TOKEN`，后台已禁用 |
| `ADMIN_FORBIDDEN` | 管理员令牌无效 |
| `BROADCAST_NOT_FOUND` | 指定广播不存在 |
| `INTERNAL_ERROR` | 未分类服务器错误 |

## POST /api/user/sync

同步用户资料、聊天记录和任务；如用户不存在会自动创建。

请求：

```json
{
  "userId": "user_demo_1234"
}
```

成功响应字段：

- `user.level`
- `user.affection`
- `user.energy`
- `user.mood`
- `user.coins`
- `user.hasCheckedInToday`
- `user.checkinStreak`：连续签到天数
- `user.loginStreak`：连续登录天数
- `account.bound`：当前游客身份是否已绑定正式账号
- `account.identifier`：已绑定账号标识（未绑定为 `null`）
- `chatHistory`
- `tasks`：每个任务包含 `category`（`daily` 每日 / `growth` 成长成就），成长任务不会每日重置
- `relationship.summary`：关系摘要
- `relationship.highlights`：关系记忆时间线高亮

## POST /api/chat

发送一条消息并获取 AI 回复。

请求：

```json
{
  "userId": "user_demo_1234",
  "text": "小希，今天辛苦吗？"
}
```

成功响应字段：

- `aiMessage`
- `user`
- `tasks`
- `systemMessages`
- `relationship`

说明：

- 每次对话会轻微消耗体力。
- 每 5 轮消息会尝试触发一次后台记忆整理。
- 文本会先经过内容安全过滤；命中敏感/风险词时返回 `CONTENT_BLOCKED`，且不会落库、不扣体力、不调用模型。
- 可通过环境变量 `EXTRA_BLOCKED_WORDS`（逗号分隔）在内置词表之外追加屏蔽词。

## POST /api/checkin

每日签到。

请求：

```json
{
  "userId": "user_demo_1234"
}
```

成功响应字段：

- `aiMsg`
- `user`：包含更新后的 `coins` 和 `checkinStreak`
- `checkinStreak`：连续签到天数
- `bonus`：本次签到发放的爱心币（按 7 天周期递增，第 7 天为大奖）
- `tasks`

业务错误：

- `ALREADY_CHECKED_IN`

## POST /api/task/claim

领取任务奖励。

请求：

```json
{
  "userId": "user_demo_1234",
  "taskId": "chat_3"
}
```

允许的 `taskId`：

- `checkin`
- `chat_3`
- `feed_1`
- `gift_1`

成功响应字段：

- `sysMsg`
- `user`
- `tasks`

## POST /api/action/feed

喂食小希。

请求：

```json
{
  "userId": "user_demo_1234",
  "foodId": "coffee"
}
```

允许的 `foodId`：

- `coffee`
- `cake`
- `bento`

成功响应字段：

- `sysMsg`
- `aiMsg`
- `user`
- `tasks`
- `systemMessages`

## POST /api/action/gift

赠送礼物。

请求：

```json
{
  "userId": "user_demo_1234",
  "giftId": "rose"
}
```

允许的 `giftId`：

- `rose`
- `necklace`
- `ring`

成功响应字段：

- `sysMsg`
- `aiMsg`
- `user`
- `tasks`
- `systemMessages`

## POST /api/action/tip

模拟打赏。

请求：

```json
{
  "userId": "user_demo_1234",
  "amount": 52,
  "paymentMethod": "wechat"
}
```

允许的 `paymentMethod`：

- `wechat`
- `alipay`

允许的 `amount`：

- `5`
- `52`
- `131.4`

成功响应字段：

- `sysMsg`
- `aiMsg`
- `order`：本次打赏对应的已结算订单 `{ id, outTradeNo, status, amount }`
- `user`
- `tasks`
- `systemMessages`

说明：`/api/action/tip` 是“即时模拟支付”快捷通道：仅当 `ALLOW_SIMULATED_PAYMENT=true`（默认关闭）时，服务端才会创建一笔真实订单并立即结算（幂等发币），同时发放打赏专属的好感/心情/体力奖励；开关关闭时直接返回 `403 TIP_SIMULATION_DISABLED`。生产环境应保持关闭，改走下面的 `/api/order/*` 与 `/api/payment/callback` 正式流程。

## POST /api/transactions

查询用户的爱心币流水（消费记录 / 钱包账单），按时间倒序返回最近 30 条。

请求：

```json
{
  "userId": "user_demo_1234"
}
```

成功响应字段：

- `transactions`：账单数组，元素包含：
  - `id`：流水唯一 ID
  - `type`：`earn`（入账）或 `spend`（出账）
  - `category`：`feed` | `gift` | `tip` | `task_reward`
  - `amount`：本次变动的爱心币数量（正整数）
  - `balance`：本次变动后的钱包余额
  - `description`：可读描述，例如「喂食 香浓拿铁 (Latte)」
  - `timestamp`：本地时间字符串（`MM-DD HH:MM`）

说明：

- 以下行为会自动写入一条流水：喂食（出账）、送礼（出账）、打赏（入账）、领取任务奖励（入账）。
- 用户不存在时返回 `USER_NOT_FOUND`。

## Payment Closed Loop（真实支付下单 / 回调验签 / 幂等发币）

### POST /api/order/create

创建一笔待支付充值订单。

请求：`{ "userId", "amount", "paymentMethod" }`（`amount` 同打赏档位，`paymentMethod` 为 `wechat`/`alipay`）。

成功响应字段：

- `order`：`{ id, outTradeNo, amount, coins, paymentMethod, status }`，`status` 为 `pending`
- `coins`：到账后将增加的爱心币
- `qrContent`：示意用二维码内容字符串
- `simulatedCallback`：一份**已签名**的模拟网关回调体，**仅当 `ALLOW_SIMULATED_PAYMENT=true` 时返回**（演示用，由前端回放）。生产环境（开关关闭）不会返回此字段——只有持有 `PAYMENT_SECRET` 的真实网关才能产生有效签名结算，客户端无法自助发币

### POST /api/payment/callback

支付网关回调（模拟）。校验签名与金额后**幂等结算**：只有首次会真正发币。

请求：`{ out_trade_no, total_amount, gateway_txn_id, result, sign }`。

成功响应字段：

- `settled`：本次是否真正结算并发币（重复回调为 `false`）
- `alreadyPaid`：订单是否此前已支付
- `status`：`paid` 或 `failed`
- `coins`：用户最新余额
- `order`

错误：`INVALID_SIGNATURE`、`AMOUNT_MISMATCH`、`ORDER_NOT_FOUND`。`result` 非 `SUCCESS` 时订单标记为 `failed`。

### POST /api/order/query

查询订单状态。请求：`{ userId, orderId }` 或 `{ userId, outTradeNo }`。响应 `order`。

### POST /api/order/list

当前用户的充值/订单历史（最多 50 条，按时间倒序）。请求 `{ userId }`。响应 `{ orders: [{ id, outTradeNo, amount, coins, paymentMethod, status, createdAt, paidAt }] }`。仅返回该用户自己的订单（按 `req.userId` 作用域过滤）。驱动钱包页「充值/订单记录」区。

## Accounts（正式账号体系 / 游客绑定）

- `POST /api/auth/register`：`{ userId, identifier, password }`（当 `REQUIRE_REGISTRATION_OTP` 开启时还需 `code` 验证码），把当前游客存档绑定到新账号。响应 `{ token, account }`；验证码无效返回 `INVALID_CODE`。
- `POST /api/auth/login`：`{ identifier, password }`。响应 `{ token, account }`，`account.userId` 为可用于跨设备同步的规范用户 ID。
- `POST /api/auth/bind`：同 register，用于给已在游玩的游客补绑账号。
- `POST /api/auth/refresh`：需 `Authorization: Bearer <token>`。续期一枚仍有效的令牌（不吊销其他设备），响应 `{ token, account }`；令牌缺失/失效返回 `AUTH_REQUIRED`。
- `POST /api/auth/logout`：需 `Authorization: Bearer <token>`。服务端吊销——递增账号 `token_version`，使该账号**所有**未过期令牌立即失效（登出全部设备 / 吊销泄露令牌）。响应 `{ ok: true }`。
- `POST /api/auth/request-code`：`{ identifier, purpose }`（`purpose` 为 `register` 或 `reset`）。下发验证码（当前为服务端日志开发桩，接真实短信/邮件见 `verification.js`）。`register` 若账号已存在返回 `ACCOUNT_EXISTS`；`reset` 始终返回通用 `{ ok: true }`（仅对已存在账号实际发送，防账号枚举）。冷却期内重复请求返回 `CODE_COOLDOWN`。开启 `OTP_DEV_ECHO` 时响应附带 `devCode`（仅供开发，生产务必关闭）。
- `POST /api/auth/reset-password`：`{ identifier, code, password }`。校验 `reset` 验证码后重置密码，并吊销该账号所有旧会话（递增 `token_version`），响应 `{ token, account }`（重置后直接登录）。验证码无效/过期返回 `INVALID_CODE`。

`identifier` 支持手机号、邮箱或 3-32 位用户名；密码 6-64 位；密码使用 scrypt 加盐哈希存储，令牌使用 HMAC 签名并带过期时间（`AUTH_TOKEN_TTL_DAYS`，默认 30 天，过期返回 `AUTH_REQUIRED`）及 `ver`（账号 `token_version`，用于服务端吊销）。登录失败锁定为两级：同一 标识+IP（默认 5 次）与同一标识跨所有 IP（默认 10 次，防换 IP 绕过，env `LOGIN_THROTTLE_IDENTIFIER_*` 可调），命中返回 `TOO_MANY_ATTEMPTS`（HTTP 429，响应头带 `Retry-After`（秒），`error.details.retryAfterMs` 给毫秒级退避提示；全局限流 `RATE_LIMITED` 同样附带）。

## User Data（数据导出 / 注销，需登录）

- `POST /api/user/export`：需登录令牌。导出该用户的全部数据 `{ export: { user, account, chatMessages, memories, tasks, relationshipEvents, transactions, orders, events } }`（账号信息不含口令哈希）。游客/未登录返回 `AUTH_REQUIRED`。
- `POST /api/user/delete`：`{ confirm: true }` + 登录令牌。**不可逆**注销：顺序删除该用户在所有表的数据并写审计，响应 `{ removed: { <table>: <count> } }`。缺少 `confirm` 返回 `INVALID_PARAMETER`。

## Themes（形象换装 / 主题换肤）

- `POST /api/themes`：`{ userId }`。响应 `{ catalog: [{ id, name, cost, icon, desc, vars }], owned: [id], equipped }`。免费主题（`cost=0`，如 `default`）所有人默认拥有。
- `POST /api/themes/unlock`：`{ userId, themeId }`。用爱心币解锁主题（原子扣币 + 流水），成功后**自动装备**。响应 `{ owned, equipped, coins }`。失败码：`INVALID_THEME` / `THEME_FREE`（免费无需解锁）/ `THEME_OWNED`（已拥有）/ `INSUFFICIENT_COINS`。并发双击同一主题不会双扣（INSERT 作闸门，重复则退款）。
- `POST /api/themes/equip`：`{ userId, themeId }`。装备一个已拥有（或免费）的主题。响应 `{ owned, equipped }`。未拥有返回 `THEME_NOT_OWNED`。

## Community（真实在线人数 / 广播）

- `POST /api/presence`：`{ userId }` 心跳。响应 `{ onlineCount, broadcasts }`。在线数 = `PRESENCE_BASELINE` + 60 秒内有心跳的真实用户数。
- `POST /api/broadcasts`：`{ userId? }` 只读拉取。响应 `{ onlineCount, broadcasts }`。广播来源于真实事件（打赏/充值、戒指送礼、升级里程碑）与运营公告。

## Memory（长期记忆管理）

- `POST /api/memory/list`：`{ userId }`。响应 `{ summary, memories: [{ key, value, weight, updatedAt }] }`。
- `POST /api/memory/add`：`{ userId, text, key? }`。用户主动让小希记住一条事实（"记住 X"）；`key` 为可选主题，省略时自动生成独立备注。经内容安全过滤、受上限淘汰，响应最新 `memories`。失败码：`CONTENT_BLOCKED` / `TEXT_TOO_LONG` / `INVALID_PARAMETER`。
- `POST /api/memory/update`：`{ userId, key, text }`。原地修改某条记忆内容（不累加 weight）。失败码：`MEMORY_NOT_FOUND` / `CONTENT_BLOCKED` / `TEXT_TOO_LONG`。
- `POST /api/memory/delete`：`{ userId, key }`。删除一条记忆，响应最新 `memories`。
- `POST /api/memory/clear`：`{ userId }`。清空全部记忆，响应 `{ cleared }`。

记忆有上限（默认 20 条），超出后按权重（被反复提及的事实权重更高）和时间淘汰。

## Analytics（行为埋点）

- `POST /api/analytics/track`：`{ userId, type, payload? }`。`type` 仅接受 UI 行为白名单（如 `open_shop`、`open_wallet`、`open_tipping`、`open_auth`）。

服务端还会自动记录关键事件：`first_chat`、`first_checkin`、`first_gift`、`first_tip`、`level_up`、`order_paid` 等，用于 DAU / 留存 / 付费转化 / ARPPU 统计。

## Admin（运营后台，需 `x-admin-token` 头）

所有 `/api/admin/*` 接口需在请求头携带 `x-admin-token: <ADMIN_TOKEN>`（仅接受请求头，不再接受请求体内的 `adminToken`，避免随日志泄露）；未配置 `ADMIN_TOKEN` 时返回 `ADMIN_DISABLED`。

- `POST /api/admin/stats`：运营指标（总用户、新增、DAU、留存、付费用户、付费转化、营收、ARPPU、关键事件计数、当前在线）。
- `POST /api/admin/users` / `orders` / `events` / `broadcasts`：分页查看（`{ limit }`）。
- `POST /api/admin/announcement`：`{ text, priority? }` 发布运营公告（写入广播）。
- `POST /api/admin/announcement/deactivate`：`{ id }` 下架公告。
- `POST /api/admin/order/refund`：`{ orderId }` 对已支付订单退款（幂等，扣回爱心币）。
- `GET /api/admin/config`：返回当前商品 / 礼物 / 打赏档位 / 任务配置（已应用运营覆盖）。
- `POST /api/admin/config`：`{ overrides: { "food:<id>:cost": <int>, "gift:<id>:cost": <int>, "tippingTier:<amount>:coins": <int>, "task:<id>:reward": <int> } }` 写入运营覆盖并写审计，**改后下次购买即生效**（任务奖励为**下次 sync 即生效**，无需重部署）；不带 `overrides` 时等价于只读返回配置（向后兼容）。键名或取值非法返回 `INVALID_OVERRIDE_KEY` / `INVALID_OVERRIDE_VALUE`。
- `POST /api/admin/audit`：`{ limit }` 查看管理操作审计日志（退款 / 公告发布 / 公告下架 / 配置覆盖等，含动作、目标、IP、时间）。

配套静态后台页面：`/admin.html`。

## Daily Reset Notes

- 每日任务（`category=daily`）会在用户下次调用 `POST /api/user/sync` 时按天重置。
- 重置会清空当日任务的 `progress`、`completed`、`claimed`；成长成就任务（`category=growth`）不重置。
- `hasCheckedInToday` 由 `users.last_checkin` 与当前日期比较得出。
- 连续签到（`checkinStreak`）在隔天断签后归零。
