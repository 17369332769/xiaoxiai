# Backend Operations

这份文档面向本地开发和小规模部署，重点说明日志、密钥、SQLite 和测试数据库的使用方式。

## Environment Variables

后端读取 `backend/.env`，推荐先从 [`.env.example`](D:/project/xiaoxiai/backend/.env.example) 复制：

```powershell
Copy-Item backend/.env.example backend/.env
```

当前支持的关键变量：

- `PORT`：后端监听端口，默认 `3000`
- `ALLOWED_ORIGIN`：允许访问 API 的前端来源，默认 `http://localhost:5173`
- `RATE_LIMIT_WINDOW_MS`：限流窗口，默认 `60000`
- `RATE_LIMIT_MAX_REQUESTS`：每个 IP 在窗口内允许的请求数，默认 `60`
- `LOG_LEVEL`：日志级别，可选 `debug`、`info`、`warn`、`error`
- `LOG_REQUESTS`：是否记录请求日志，默认 `true`
- `XIAOXIAI_DB_PATH`：SQLite 文件路径，默认是 [database.sqlite](D:/project/xiaoxiai/backend/database.sqlite)
- `PRESENCE_BASELINE`：在真实在线人数上叠加的展示基数，默认 `0`
- `PAYMENT_SECRET`：支付回调签名密钥（HMAC-SHA256），生产环境必须设置为强随机值
- `AUTH_SECRET`：账号登录令牌签名密钥（HMAC-SHA256），生产环境必须设置为强随机值
- `ADMIN_TOKEN`：运营后台令牌；留空则 `/admin.html` 与 `/api/admin/*` 全部禁用（fail-closed）
- `OPENAI_API_KEY`：外部模型服务密钥
- `OPENAI_API_BASE_URL`：兼容 OpenAI SDK 的服务地址
- `OPENAI_MODEL_NAME`：模型名，例如 `gpt-4o-mini`

## Secrets & Admin

- `PAYMENT_SECRET` / `AUTH_SECRET` 未设置时会使用内置开发默认值，并在启动日志打印 warning。生产部署务必通过环境变量覆盖，且不要写入版本库。
- `ADMIN_TOKEN` 默认空，此时运营后台返回 `ADMIN_DISABLED`。设置后访问 `/admin.html`，在登录框输入该令牌即可进入；接口侧通过 `x-admin-token` 请求头做常量时间校验。
- 账号密码使用 `scrypt` 加盐哈希存储，登录令牌为 HMAC 签名的紧凑串（演示版未做过期与刷新，生产可在此基础上加 `exp`）。
- 支付回调使用 `PAYMENT_SECRET` 对回调参数做 HMAC 验签，并校验金额与订单是否一致；发币通过条件 UPDATE 抢占订单状态实现幂等（重复回调不会重复发币）。

## Secret Handling

`backend/.env` 应只用于本地或受控环境，不应该提交真实密钥。

如果仓库里已经出现真实 `OPENAI_API_KEY`，建议按下面顺序处理：

1. 立即到对应模型平台轮换密钥，旧 key 视为已泄露。
2. 确认本机和部署环境更新为新 key。
3. 停止继续提交真实 `backend/.env`。
4. 将真实配置保留在本地，仓库内只保留 [`.env.example`](D:/project/xiaoxiai/backend/.env.example)。

如果 `backend/.env` 已经被 Git 跟踪，仅靠 `.gitignore` 不会生效。可以在确认本地文件保留后执行：

```powershell
git rm --cached backend/.env
```

仓库根目录还提供了一个快速自检：

```powershell
npm run check:secrets
```

它会在 `backend/.env` 这类敏感文件重新被 Git 跟踪时直接报错。

## Logging

后端现在使用统一日志层：

- 普通运行信息：`info`
- 可恢复问题：`warn`
- 服务异常：`error`
- 调试细节：`debug`

请求日志默认开启，格式包含：

- 请求方法
- 请求路径
- 状态码
- 耗时
- 来源 IP

请求体默认不会写入日志，避免把聊天内容或潜在敏感字段打进日志文件。

常用调试方式：

```powershell
$env:LOG_LEVEL="debug"
$env:LOG_REQUESTS="true"
npm --prefix backend run dev
```

## SQLite Notes

默认数据库路径是 [database.sqlite](D:/project/xiaoxiai/backend/database.sqlite)。

建议：

- 本地开发使用默认路径即可
- 自动化测试使用独立临时库
- 不要把测试库或运行期生成的 `*.sqlite-wal`、`*.sqlite-shm` 提交到仓库

如果需要切换数据库位置：

```powershell
$env:XIAOXIAI_DB_PATH="D:\\data\\xiaoxiai.sqlite"
npm --prefix backend run dev
```

备份 SQLite 时，至少同时关注：

- 主库文件 `*.sqlite`
- 预写日志 `*.sqlite-wal`
- 共享内存文件 `*.sqlite-shm`

如果数据库正在写入，最好在服务停止后再复制，避免备份不一致。

## Test Database Behavior

后端测试会通过 `XIAOXIAI_DB_PATH` 指向一个临时 SQLite 文件，不会复用你的本地开发库。

验证命令：

```powershell
npm --prefix backend test
```

## Recommended Verification

日常改动后至少执行：

```powershell
npm test
npm --prefix backend test
npm run lint
npm run build
```

如果要在提交前一次性完成检查，优先使用：

```powershell
npm run verify
```
