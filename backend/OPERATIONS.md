# Backend Operations

这份文档面向本地开发和小规模部署，重点说明日志、密钥、SQLite 和测试数据库的使用方式。

## Environment Variables

后端读取 `backend/.env`，推荐先从 [`.env.example`](.env.example) 复制：

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
- `EXTRA_BLOCKED_WORDS`：聊天内容安全过滤的额外屏蔽词（逗号分隔），追加到内置词表
- `MEMORY_CAP`：每个用户长期记忆条数上限，默认 `20`；超出后按权重（被反复提及的事实权重更高）和时间淘汰，非法/缺省值回落到 `20`
- `MEMORY_TTL_DAYS`：长期记忆失效天数，默认 `0`（关闭）；>0 时在记忆整理阶段清理 `updated_at` 超过 N 天且权重 ≤ 1（未被反复提及）的陈旧记忆，高权重重要记忆不因时间删除，非法/缺省值回落到 `0`
- `XIAOXIAI_DB_PATH`：SQLite 文件路径，默认是 `backend/database.sqlite`（本地运行时生成，不建议提交到仓库）
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
4. 将真实配置保留在本地，仓库内只保留 [`.env.example`](.env.example)。

如果 `backend/.env` 已经被 Git 跟踪，仅靠 `.gitignore` 不会生效。可以在确认本地文件保留后执行：

```powershell
git rm --cached backend/.env
```

仓库根目录还提供了一个快速自检：

```powershell
npm run check:secrets
```

它会在 `backend/.env` 这类敏感文件重新被 Git 跟踪时直接报错。

## Production Deployment（生产部署）

生产环境由两部分组成：**静态前端**（Vite 构建产物 `dist/`，由 Nginx 等静态服务器托管）和**后端 API**（`backend/` 下的 Express 进程，默认监听 `127.0.0.1:3000`）。后端只提供 `/api/*` 接口，不托管任何静态资源，因此前端构建产物和 `admin.html` 都必须由静态层提供。

### 1. 构建前端

在项目根目录构建，产物输出到 `dist/`：

```powershell
npm install
npm run build
```

```bash
# Linux / macOS 等价
npm install
npm run build
```

`npm run build` 会把 `public/` 下的内容（包括运营后台页 `admin.html`）一并复制进 `dist/`，所以构建后 `dist/admin.html` 就是生产环境的后台入口，由静态服务器直接提供，无需后端托管。

### 2. 运行后端

后端用 `npm start`（即 `node server.js`）启动：

```powershell
cd backend
npm ci --omit=dev
npm start
```

```bash
# Linux / macOS 等价
cd backend
npm ci --omit=dev
npm start
```

生产环境建议用进程守护工具拉起后端，避免崩溃后不自动恢复。

最小 [pm2](https://pm2.keymetrics.io/) 示例：

```bash
cd backend
pm2 start server.js --name xiaoxiai-api
pm2 save
pm2 startup   # 按提示生成开机自启脚本
```

或使用 systemd unit（`/etc/systemd/system/xiaoxiai-api.service`）：

```ini
[Unit]
Description=Xiaoxiai API
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/xiaoxiai/backend
ExecStart=/usr/bin/node server.js
EnvironmentFile=/srv/xiaoxiai/backend/.env
Restart=on-failure
User=xiaoxiai

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now xiaoxiai-api
```

> systemd 通过 `EnvironmentFile` 读取 `backend/.env`；请确保该文件存在且不入库（见下方环境变量与密钥说明）。

### 3. Nginx 反向代理示例

由 Nginx 托管 `dist/`，并把 `/api` 代理到后端。`admin.html` 已经在 `dist/` 里，按普通静态文件提供即可（它内部调用的 `/api/admin/*` 会经由同一个 `/api` 代理走到后端）。

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    # 前端静态产物（含 admin.html）
    root /srv/xiaoxiai/dist;
    index index.html;

    # API 反向代理到后端
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 运营后台页（静态文件，已随构建进入 dist/）
    location = /admin.html {
        try_files /admin.html =404;
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

关于 `/admin.html` 的访问方式：它源文件是 `public/admin.html`，开发环境由 Vite 直接提供，生产环境由 `npm run build` 复制进 `dist/` 后作为静态文件提供（如上）。**后端不托管它。** 如果你的部署不走静态层（例如只想暴露后端），可改为：把 `public/admin.html` 单独放进静态目录提供，或在你的反向代理/网关上为 `/admin.html` 单独加一条托管/代理规则。无论哪种方式，都要确保它能调到 `/api/admin/*`（需 `x-admin-token` 头与已配置的 `ADMIN_TOKEN`）。

### 4. 生产必须覆盖的环境变量

以下变量在生产环境**必须**显式设置（不要使用内置开发默认值）：

- `AUTH_SECRET`：账号登录令牌签名密钥（HMAC），设为强随机值。
- `PAYMENT_SECRET`：支付回调签名密钥（HMAC），设为强随机值。
- `ADMIN_TOKEN`：运营后台令牌；不设则后台 fail-closed 全禁用，设则务必使用高强度令牌。
- `ALLOWED_ORIGIN`：允许访问 API 的前端来源，必须指向前端真实域名（例如 `https://your-domain.example.com`），否则跨域请求会被 `FORBIDDEN_ORIGIN` 拒绝。

`backend/.env` 承载这些密钥，**绝不入库**；用 `npm run check:secrets` 自检。

### 5. 数据库与备份

- 生产 SQLite 文件路径用 `XIAOXIAI_DB_PATH` 指向一个持久化、可备份的目录（例如 `/var/lib/xiaoxiai/xiaoxiai.sqlite`），不要留在仓库目录内，避免发布覆盖。
- 备份时同时关注主库 `*.sqlite` 以及 `*.sqlite-wal`、`*.sqlite-shm`；数据库正在写入时建议先停服再复制，避免备份不一致（详见下方 SQLite Notes）。

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

默认数据库路径是 `backend/database.sqlite`。

建议：

- 本地开发使用默认路径即可
- 自动化测试使用独立临时库
- `database.sqlite` 属于运行时数据文件，默认不应提交到仓库
- 不要把测试库或运行期生成的 `*.sqlite-wal`、`*.sqlite-shm` 提交到仓库

如果需要切换数据库位置：

```powershell
# Windows PowerShell
$env:XIAOXIAI_DB_PATH="C:\\data\\xiaoxiai.sqlite"
npm --prefix backend run dev
```

```bash
# Linux / macOS
export XIAOXIAI_DB_PATH=/var/lib/xiaoxiai/xiaoxiai.sqlite
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
