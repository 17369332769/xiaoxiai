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
| `INVALID_PARAMETER` | 商品 ID、任务 ID、支付方式等参数不合法 |
| `USER_NOT_FOUND` | 用户不存在 |
| `RESOURCE_NOT_FOUND` | 用户或任务等资源不存在 |
| `INSUFFICIENT_COINS` | 爱心币不足 |
| `TASK_NOT_CLAIMABLE` | 任务未完成或已领取 |
| `ALREADY_CHECKED_IN` | 当天已签到 |
| `INVALID_TIP_TIER` | 打赏档位不合法 |
| `FORBIDDEN_ORIGIN` | 请求来源不在允许列表内 |
| `RATE_LIMITED` | 请求频率过高 |
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
- `chatHistory`
- `tasks`

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

说明：

- 每次对话会轻微消耗体力。
- 每 5 轮消息会尝试触发一次后台记忆整理。

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
- `user`
- `tasks`
- `systemMessages`

## Daily Reset Notes

- 每日任务会在用户下次调用 `POST /api/user/sync` 时按天重置。
- 重置会清空当前任务的 `progress`、`completed`、`claimed`。
- `hasCheckedInToday` 由 `users.last_checkin` 与当前日期比较得出。
