# Backend API Reference

后端默认基地址：

```text
http://localhost:3000
```

所有接口当前均为 `POST`，请求体为 JSON。

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

说明：`/api/action/tip` 是“即时模拟支付”快捷通道：服务端会创建一笔真实订单并立即结算（幂等发币），同时发放打赏专属的好感/心情/体力奖励。若需要演示完整的“下单→扫码→回调验签→发币”流程，请使用下面的 `/api/order/*` 与 `/api/payment/callback`。

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
- `simulatedCallback`：一份**已签名**的模拟网关回调体（真实环境由支付网关服务端回调；演示时由前端回放）

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

## Accounts（正式账号体系 / 游客绑定）

- `POST /api/auth/register`：`{ userId, identifier, password }`，把当前游客存档绑定到新账号。响应 `{ token, account }`。
- `POST /api/auth/login`：`{ identifier, password }`。响应 `{ token, account }`，`account.userId` 为可用于跨设备同步的规范用户 ID。
- `POST /api/auth/bind`：同 register，用于给已在游玩的游客补绑账号。

`identifier` 支持手机号、邮箱或 3-32 位用户名；密码 6-64 位；密码使用 scrypt 加盐哈希存储，令牌使用 HMAC 签名。

## Community（真实在线人数 / 广播）

- `POST /api/presence`：`{ userId }` 心跳。响应 `{ onlineCount, broadcasts }`。在线数 = `PRESENCE_BASELINE` + 60 秒内有心跳的真实用户数。
- `POST /api/broadcasts`：`{ userId? }` 只读拉取。响应 `{ onlineCount, broadcasts }`。广播来源于真实事件（打赏/充值、戒指送礼、升级里程碑）与运营公告。

## Memory（长期记忆管理）

- `POST /api/memory/list`：`{ userId }`。响应 `{ summary, memories: [{ key, value, weight, updatedAt }] }`。
- `POST /api/memory/delete`：`{ userId, key }`。删除一条记忆，响应最新 `memories`。
- `POST /api/memory/clear`：`{ userId }`。清空全部记忆，响应 `{ cleared }`。

记忆有上限（默认 20 条），超出后按权重（被反复提及的事实权重更高）和时间淘汰。

## Analytics（行为埋点）

- `POST /api/analytics/track`：`{ userId, type, payload? }`。`type` 仅接受 UI 行为白名单（如 `open_shop`、`open_wallet`、`open_tipping`、`open_auth`）。

服务端还会自动记录关键事件：`first_chat`、`first_checkin`、`first_gift`、`first_tip`、`level_up`、`order_paid` 等，用于 DAU / 留存 / 付费转化 / ARPPU 统计。

## Admin（运营后台，需 `x-admin-token` 头）

所有 `/api/admin/*` 接口需在请求头携带 `x-admin-token: <ADMIN_TOKEN>`；未配置 `ADMIN_TOKEN` 时返回 `ADMIN_DISABLED`。

- `POST /api/admin/stats`：运营指标（总用户、新增、DAU、留存、付费用户、付费转化、营收、ARPPU、关键事件计数、当前在线）。
- `POST /api/admin/users` / `orders` / `events` / `broadcasts`：分页查看（`{ limit }`）。
- `POST /api/admin/announcement`：`{ text, priority? }` 发布运营公告（写入广播）。
- `POST /api/admin/announcement/deactivate`：`{ id }` 下架公告。
- `POST /api/admin/order/refund`：`{ orderId }` 对已支付订单退款（幂等，扣回爱心币）。
- `POST /api/admin/config`：只读返回当前商品 / 礼物 / 打赏档位 / 任务配置。

配套静态后台页面：`/admin.html`。

## Daily Reset Notes

- 每日任务（`category=daily`）会在用户下次调用 `POST /api/user/sync` 时按天重置。
- 重置会清空当日任务的 `progress`、`completed`、`claimed`；成长成就任务（`category=growth`）不重置。
- `hasCheckedInToday` 由 `users.last_checkin` 与当前日期比较得出。
- 连续签到（`checkinStreak`）在隔天断签后归零。
