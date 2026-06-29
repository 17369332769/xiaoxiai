# 小希 AI · 改进台账（Improvement Ledger）

> 本台账记录基于代码审计得出的待办、优先级、负责方式与进度。
> 创建于 2026-06-22。状态：⬜ 待办 / 🟡 进行中 / ✅ 完成 / ⏸ 暂缓（需用户决策）。

## 执行方式

- 采用多 agent workflow 推进：**设计（并行只读）→ 实现（单流串行）→ 审查+验证（并行）**。
- 每完成一项更新本表「状态」「结论」列。
- 未经用户许可不执行 `git commit`（见历史教训：workflow 子 agent 曾擅自提交）。

---

## P0 · 必须修（安全/正确性，本轮执行目标）

| # | 项 | 文件 | 状态 | 结论 |
|---|---|---|---|---|
| P0-1 | **鉴权强制**：token 签发后从不校验，所有业务接口仅凭 body.userId 识别用户，已绑定账号无任何保护 | `resolveUser.js`(新) `app.js` 各 `*Routes.js` `src/utils/apiClient.js` | ✅ | resolveUser 中间件：按路由前缀挂载、token 优先、绑定账号无 token → 401；前端自动带 Bearer。3 审查 agent 实测越权攻击均被 401 拦截，verdict=ship |
| P0-2 | **免费刷币**：`/api/action/tip` 即时结算不经支付；**且** `/api/order/create` 由服务端自签回调体供客户端回放（审计新增发现 A1，同类漏洞） | `apiRoutes.js:716` `orderRoutes.js:42` | ✅ | 统一 `ALLOW_SIMULATED_PAYMENT`（默认关 + 生产强制关）同时守卫两路径；关时 tip→403、order/create 不下发可回放回调，真实签名回调仍可结算 |
| ~~P0-3~~ | ~~.env 泄露~~ | — | ✅ | `.env` 未被 git 跟踪，`.gitignore` 已正确配置 |

> **审计修正**：原 P0-2 仅覆盖 tip，遗漏了 `/api/order/create` 自签回调这条等价的免费刷币路径——只修 tip 不够。两者已合并，用同一开关守卫。

### P0-1 设计要点（鉴权强制，向后兼容）
- 新增 `resolveUser` 中间件：
  1. 若请求带有效 `xxa_token` → userId 以 token 为准（authoritative），忽略/校验 body.userId。
  2. 若无 token → 取 body.userId；**若该 userId 已绑定账号 → 拒绝（401，必须登录）**；否则按游客放行。
- 效果：已绑定账号只能凭 token 访问（堵住接管），游客照旧（不破坏现有无 token 测试）。
- 前端 `apiClient.postJson` 统一带 `Authorization: Bearer <xxa_token>`。
- 需同步更新后端测试（验证带/不带 token、绑定账号拒绝无 token）。

---

## P1 · 产品完整性（规划，待用户排期）

| # | 项 | 说明 | 状态 |
|---|---|---|---|
| P1-1 | 服务端流式 SSE 输出 | 现仅前端打字机模拟，首字延迟 = 整次 LLM 调用 | 🟢 **已完成**：后端 `POST /api/chat/stream`（SSE，`generateAiResponseStream` 纯文本流 + 服务端推导情绪/增量 + 输出安全兜底，原 /api/chat 保留）；前端 `postSse` 消费 SSE + `sendMessage` 真打字机（delta 实时占位 / done 权威替换 / error·截断兜底 / CRLF 归一），多 agent 交叉验证 + 补测 |
| P1-2 | 语音能力（TTS 回复 / STT 输入） | 陪伴品类近乎刚需，当前完全没有 | 🟢 **TTS**：后端对接 RunningHub Index-TTS AI App（`/openapi/v2/run/ai-app/<id>` + nodeInfoList + 轮询 query），`.env` 按官方示例预填**开箱可用**，5 单测；前端每条回复 🔊 按钮 → `playVoice` → `/api/tts` 播放（方案 B 按需）。**STT**：ChatBox 🎤 按钮用浏览器 SpeechRecognition（免费）。**真实联调已通过**（2026-06-23：text→真实 FLAC 音频可达，但单次延迟 ~80s，逼近 90s `maxWaitMs`）。待办：换自有音色样本（node 9）+（可选）治理 ~80s 延迟/超时余量 |
| P1-3 | 形象/换装系统 | 仅 3 张静态图；缺可永久收藏的变现点 | 🟢 已完成（第20轮）：主题换肤——5 套主题，爱心币解锁+一键切换，运行时改 CSS 变量重塑配色，服务端持久化跨设备同步（受限于固定立绘，实现为主题级换肤）|
| P1-4 | 主动触达 / 召回 | 纯拉取式，无推送、无"想你了"定时消息 | 🟢 已完成（第21轮）：回归问候——按离开时长分级（<1天/1-3天/3+天），sync 时注入暖心 AI 消息，阈值可配 |
| P1-5 | 玩法深化 | 约会剧情/分支/小游戏/纪念日 | ⏸ |
| P1-6 | 记忆可主动编辑 | 现仅能删，不能"让她记住 X"/修改 | 🟢 后端完成：`POST /api/memory/add`（"记住 X"，可选 topic key）+ `/api/memory/update`（原地改、weight 不累加），内容安全过滤 + cap 淘汰，6 集成测；前端 UI 待接 |
| P1-7 | 令牌过期/刷新/吊销 | 当前 token 无 exp、登出仅本地删 | ✅ exp+校验（A7）+ `token_version` 服务端吊销：`/api/auth/logout`（吊销全部）/`/api/auth/refresh`（续期不吊销他端），resolveUser 校验 ver，legacy 无 ver 兼容，4 集成测；**前端已接**（第18轮）：登录态确认绑定后自动 `/api/auth/refresh` 续期 effect（每 12h），长开标签页不再静默掉登录 |
| P1-8 | 注册验证 | 手机号/邮箱无 OTP，可注册任意号 | 🟢 已完成（第19轮）：注册 OTP（`REQUIRE_REGISTRATION_OTP` env 门控，默认关向后兼容）；验证码 sha256+过期+锁定+冷却；**发送为控制台开发桩，真实短信/邮件待接服务商** |
| P1-9 | 密码找回 | 无找回流程 | 🟢 已完成（第19轮）：`request-code(reset)`（防枚举）+ `reset-password`（验证码→重置→吊销旧会话→直接登录）；前端忘记密码流程 |

## P2 · 体验/变现/运营/合规（规划）

| # | 项 | 说明 | 状态 |
|---|---|---|---|
| P2-1 | 会员订阅/首充/限时礼包 | 仅一次性打赏档位 | ⏸ |
| P2-2 | 后台可写配置 | 现 `/api/admin/config` 只读，商品/任务硬编码需重部署 | 🟢 已完成：`config_overrides` 表 + 同步覆盖层（启动加载/写入刷新缓存），`GET/POST /api/admin/config` 校验+审计，商品/打赏价改后**下次购买即生效**无需重部署，9 测；**任务奖励也已可覆盖**（`task:<id>:reward`，下次 sync 即生效，第18轮）|
| P2-3 | 管理操作审计日志 | 退款等敏感操作无留痕 | ✅ 已做（C4，`admin_audit` + `/api/admin/audit`）|
| P2-4 | 内容安全升级 | 现仅词表，需接入模型审核 + 实名/青少年模式（国内合规） | ⏸ |
| P2-5 | 用户侧数据导出/注销 | 隐私合规缺口，无隐私政策/ToS | 🟢 后端完成：`POST /api/user/export`（全量数据，含账号但**不含口令哈希**）+ `/api/user/delete`（confirm 确认，顺序删 9 张表+审计），4 集成测；**前端已接**（第18轮）：AuthModal「数据与隐私」区——导出我的数据（JSON 下载）/ 二步确认永久注销（清本地 + 轮换新游客）；隐私政策/ToS 文档待补 |
| P2-6 | 可观测性 | 无 Sentry/指标/健康检查/CI | 🟡 health(C3)+CI 已做；指标/Sentry 仍 ⏸ |
| P2-7 | 数据层 | SQLite 单写入，无自动备份代码 | 🟢 自动备份完成：`backup.js` 用 `VACUUM INTO`（原子/WAL 安全）定时备份 + 保留轮换，env 可配/可禁用，timer `unref` 不挂测试，5 测；多写入扩容仍为后续 |
| P2-8 | i18n | 仅中文 | ⏸ |

---

## 审计新增发现（独立 agent 复核，按"P0 后优先级"排序）

| # | 严重度 | 项 | 证据 | 状态 |
|---|---|---|---|---|
| A1 | 高 | `/api/order/create` 自签回调 = 第二条免费刷币路径 | `orderRoutes.js:42-56` | ✅ 已并入 P0-2 修复 |
| A2 | 高 | 登录/注册无防爆破（仅全局每 IP 限流） | `accountRoutes.js:55` | ✅ 第2轮：`authThrottle.js` 标识+IP 失败锁定 |
| A12 | 高 | **未设 trust proxy**：Nginx 后 `req.ip` 全塌成 127.0.0.1 → 限流/防爆破退化为全站单桶（DoS+越锁）。审查发现的既有隐患 | `app.js` `middleware.js:31` | ✅ 第2轮：`app.set('trust proxy', TRUST_PROXY)`，默认 loopback，运行时已验证 |
| C1/C2-合规 | 高 | 内容审核仅词表，无实名/青少年模式（国内合规阻断项） | `contentSafety.js:8` | ⏸ → P2-4 |
| C2 | 高 | SQLite 无 WAL / 无 busy_timeout / 无备份；后台记忆整理可自撞 `SQLITE_BUSY` 500 | `db.js` | ✅ 第2轮：WAL+busy_timeout（备份仍 ⏸） |
| A5 | 中 | `reflectAndConsolidate` fire-and-forget，记忆上限/淘汰读改删非原子 | `memoryEngine.js` | ✅ 第2轮：改为按用户**串行链式**（既防并发又保新鲜，解审查 medium） |
| A4 | 中 | `/api/chat` 先扣体力/落库用户消息再生成，非事务，崩溃会留悬挂消息 | `apiRoutes.js:517-548` | ⏸ |
| A7 | 中 | token 无 exp、无法吊销（P0-1 落地后即为安全 bug，非纯产品项） | `accounts.js:86` | ✅ 第2轮：加 exp+校验（吊销/刷新仍 ⏸） |
| A6 | 中 | 登录切换 userId 直接丢弃游客存档，无合并/告警 | `useGameStore.js:312` | ✅ 第5轮：游客有进度时登录前两步确认（提示进度不合并，引导改用绑定）；审查抓到的"确认态跨开关残留"已修 |
| A8 | 低 | `getTodayKey` 与 SQL `date()` 比较错位风险 | `gameplay.js:11` `analytics.js:84` | ✅ 第3轮**核实为非 bug**（getStats 两侧同源比较，两审查 agent 独立确认）；仅 locale 格式脆弱性，改有迁移成本，不动 |
| A9 | 低 | `database.sqlite` 曾被提交进 git **历史**（含 PII/口令哈希/聊天）；当前树已干净但历史未清 | `git log -- backend/database.sqlite` | ⏸（推送前需清史） |
| A10 | 低 | admin token 允许从 body 传入，易随日志泄露 | `adminAuth.js:14` | ✅ 第3轮：改为仅接受 `x-admin-token` 请求头 |
| A11 | 低 | `chat_messages.id = prefix-${Date.now()}` 高频撞 UNIQUE（verify 日志可见） | `httpUtils.js` `apiRoutes.js` `orderRoutes.js` | ✅ 第2轮：`generateId()` 加随机后缀（`transactions.id` 仍 ⏸，影响小） |
| C6 | 低 | `chat_messages` 无保留/清理策略，无限增长 | `db.js:117` | ✅ 第4轮：`pruneUserChat`（保留最新 `CHAT_HISTORY_CAP=300`），在 **sync** 触发（避开反思计数），裁剪所有消息类型 |
| B7 | 低 | 前端硬编码假"最新广播"种子 + 假在线数 1314，真实 feed 前展示伪造社交证明 | `useGameStore.js:43` | ✅ 第3轮：删假广播种子+死代码 `createSimulatedRecentEvent`，在线数种子 1314→1 |
| C3 | 中 | 无 `/health`、无指标、无 Sentry、无 CI | 全局缺失 | ✅ 第4轮 health；第6轮 CI（`.github/workflows/ci.yml` 跑 verify）；指标/Sentry 仍 ⏸ |
| C4 | 中 | 退款/公告等管理操作无审计日志 | `adminRoutes.js:89` | ✅ 第3轮：`admin_audit` 表 + `adminAudit.js`，退款/公告发布/下架写入，`/api/admin/audit` 可查 |
| B8 | 低 | 生产关闭模拟支付后，ShopModal 即时打赏/我已完成支付按钮成死路 | `src/components/ShopModal.jsx` | ✅ 第5轮：sync 透传 `allowSimulatedPayment`；关闭时隐藏即时打赏按钮、按订单有无回调隐藏"我已完成支付"，真实扫码升为主按钮 |
| A2b | 低 | 防爆破仅 标识+IP，换 IP 可绕；`buckets` 超阈值才清扫 | `authThrottle.js` | ✅ 加纯标识维度二级锁（跨 IP 锁定，env 可调阈值），两 Map 同步清扫，4 单测；多实例共享存储仍待（已注明） |

**建议 P0 后的下一步顺序**：A1(已并入) → C2 SQLite 加固 → A2/A7 鉴权防爆破+token exp → A6 登录数据合并 → C1/C5 合规基线。

---

## 本轮交付（P0）落地清单

**改动文件**（均在工作树，未提交，等你 review）：
- 新增：`backend/resolveUser.js`、`backend/tests/security.test.js`、`IMPROVEMENT_LEDGER.md`
- 后端：`app.js` `server.js` `apiRoutes.js` `orderRoutes.js` `memoryRoutes.js` `analyticsRoutes.js` `communityRoutes.js`
- 前端：`src/utils/apiClient.js`（带 Bearer）、`src/hooks/useGameStore.js`（401 恢复）
- 文档/配置：`README.md` `backend/API.md` `backend/.env.example`、`backend/.env`(本地加 `ALLOW_SIMULATED_PAYMENT=true` 保留 demo)
- 测试：`api.test.js` / `extended.test.js` 加开关与 3 条鉴权用例；新增 3 条安全用例

**验证**：`npm run verify` 全绿（check:secrets + eslint + 前端 46 + 后端 84 + build），EXIT 0。

**对抗式审查**（3 agent 并行，实测起服务发攻击请求）：均 verdict=**ship**，无 critical/high。已采纳的低/中级建议：
- ✅ 修复（中）：绑定账号丢失 token 时前端不再误报"后端宕机"，改为清 token+降级游客+提示重登
- ✅ 加固：`NODE_ENV=production` 下强制关闭 `ALLOW_SIMULATED_PAYMENT`（即使 .env 误设）
- ✅ resolveUser 对"签名有效但 userId 畸形"的 token 改为宽松回退（与注释一致）
- ✅ 安全用例加强：被拦截的 tip 不产生订单行；真实回调重放幂等不重复发币

**审查提出、本轮未做的跟进项**（已记入下方 backlog）：
- 生产模式下 ShopModal 的"即时打赏/我已完成支付"按钮会失效——需把 `ALLOW_SIMULATED_PAYMENT` 暴露给前端（如 `/api/config`）后隐藏/改文案。→ 新增 B8。
- 新观察：`chat_messages.id = ai-${Date.now()}` 在高频调用下可能撞 UNIQUE（测试日志可见，非本轮引入）。→ 新增 A11。

## 第2轮交付（可靠性 + 鉴权加固）

**改动文件**（工作树，未提交）：
- 新增：`backend/authThrottle.js`
- 后端：`db.js`(WAL/busy_timeout) `memoryEngine.js`(串行链式) `accounts.js`(token exp) `accountRoutes.js`(防爆破) `app.js`+`server.js`(trust proxy) `httpUtils.js`(generateId) `apiRoutes.js`+`orderRoutes.js`(消息 id)
- 测试：`extended.test.js` 加防爆破 + token 过期用例（后端 84→86）
- 文档：`backend/API.md`（TOO_MANY_ATTEMPTS / token TTL / 节流）、`backend/.env.example`（AUTH_TOKEN_TTL_DAYS / TRUST_PROXY）

**验证**：`npm run verify` 全绿（后端 86 + 前端 46 + build），EXIT 0；`SQLITE_CONSTRAINT` 日志噪音消失；trust proxy 运行时实测 XFF 生效。

**对抗式审查**（workflow#3，3 agent，实测起服务攻击）：DB/回归=ship，鉴权=fix-needed。已采纳修复：
- 🔴 修复（critical）：补 `trust proxy`（原 `req.ip` 在 Nginx 后全塌成 127.0.0.1，会让限流+防爆破退化为全站单桶 / 越锁 DoS）
- 🟠 修复（medium）：`authThrottle` buckets 超阈值清扫，防无界增长
- 🟠 修复（medium）：A5 由"合并"改"串行链式"，消除被 await 的 no-openai 路径拿到陈旧反思的问题
- 🟡 修复（low）：A11 消息 id 加随机后缀，消除并发同用户撞 UNIQUE
- ⏸ 未做（low，记入 backlog A2b/B8）：换 IP 绕过的二级标识锁、生产 UI 死路

## 第3轮交付（运营/数据/前端 hygiene）

**改动文件**（工作树，未提交）：
- 新增：`backend/adminAudit.js`
- 后端：`db.js`(admin_audit 表) `adminRoutes.js`(审计写入+`/api/admin/audit`) `adminAuth.js`(token 仅请求头)
- 前端：`src/utils/gameStoreHelpers.js`(删假广播死代码) `src/hooks/useGameStore.js`(删假广播种子、在线数 1314→1)
- 文档：`backend/API.md`（audit 端点、header-only）
- 测试：`extended.test.js` 折叠出自包含的审计断言 + header-only 用例

**验证**：`npm run verify` 全绿（后端 87 + 前端 46 + build），EXIT 0。

**对抗式审查**（workflow#4，2 agent）：两者均 **ship**，并**独立确认 A8 非 bug**。采纳的低级改进：退款 no-op 不写审计、在线数假种子归 1、审计测试自包含。

**A8 决策**：核实后判定**非 bug，不改**——getStats 中 day_key 仅与同源 `getTodayKey()` 比较、created_at 用 SQL `date()` 两侧一致；改格式有存量迁移成本。这是"先验证再动手、避免按误诊改动正常代码"的一次体现。

## 第4轮交付（保留策略 + 探活）

**改动文件**（工作树，未提交）：
- 后端：`gameplay.js`(`pruneUserChat`+`CHAT_HISTORY_CAP`) `apiRoutes.js`(sync 触发裁剪) `app.js`(`GET /api/health`)
- 文档：`backend/API.md`(health) `backend/.env.example`(CHAT_HISTORY_CAP)
- 测试：`extended.test.js` 加聊天裁剪 + health 用例

**验证**：`npm run verify` 全绿（后端 89 + 前端 46 + build），EXIT 0。

**对抗式审查**（workflow#5，2 agent）：均 ship，但 correctness 抓到 1 **medium**（我引入的真 bug）+2 low，已全部修复后复跑全绿：
- 🟠 medium：裁剪原放在 chat 处理里，会把 `chat_messages` 计数钉在 300（5 的倍数）→ 反思触发器每轮误触发。**修复**：裁剪移到 `/api/user/sync`，与反思计数彻底解耦（顺带也修了"只做动作不聊天的用户无界增长"那条 low）。
- 🟡 low×2：`pruneUserChat` 改用 `rowid`（消除 NULL-in-NOT-IN 陷阱）+ `keep<1` 保护（绝不误删全部）。

## 第5轮交付（前端 UX 正确性）

**改动文件**（工作树，未提交）：
- 前端：`AuthModal.jsx`(登录两步确认+`handleClose` 重置) `ShopModal.jsx`(按开关隐藏死按钮) `useGameStore.js`(`hasGuestProgress`+`allowSimulatedPayment`) `App.jsx`(透传)
- 后端：`apiRoutes.js`(sync 响应加 `allowSimulatedPayment`)
- 测试：`ShopModal.test.jsx`（即时按钮测试改为显式开启开关 + 新增"关闭时隐藏即时按钮"用例，前端 46→47）

**验证**：`npm run verify` 全绿（后端 89 + 前端 47 + build），EXIT 0。

**对抗式审查**（workflow#6，2 agent）：B8=ship，A6=fix-needed。已修复：
- 🟠 medium（A6，我引入）：`confirmingLogin` 跨"关闭再打开"残留 → 二次打开一键即登录、绕过警告。**修复**：`handleClose` 在每次关闭时重置确认态（避开"effect 内 setState"的 lint 规则）。
- 🟡 low（B8）：超时文案在生产态承诺"自动更新"但轮询已停 → 改为"重开页面即可刷新到账"。

## 第6轮交付（CI）

**改动文件**（工作树，未提交）：新增 `.github/workflows/ci.yml`（push main + PR：setup-node 22 → 安装根/后端依赖 → `npm run verify`）。

**验证**：YAML 可解析；命令与 `package.json` 脚本一致；根/后端 lockfile 均在（`npm ci` 前置满足）。无法本地跑 GitHub Actions，故仅做静态校验 + 只读 **Explore** agent 审查（verdict=ship；node 22 满足 Vite 8、rolldown/sqlite3 原生依赖在 CI 上低风险）。**本次审查改用 Explore（无 Bash/git）→ 无任何 git 副作用。**

## 进度日志

- 2026-06-22 建立台账；核对代码完成审计；确定本轮执行 P0-1 / P0-2。
- 2026-06-22 workflow#1（3 agent 并行设计+审计）→ 据此实现 P0；workflow#2（3 agent 对抗式审查）verdict=ship；采纳 4 项加固；`npm run verify` 全绿；未提交（HEAD 仍 8db8313）。
- 2026-06-22 第2轮：实现 C2/A5/A2/A7；workflow#3 对抗式审查发现 1 critical（trust proxy）+2 medium，全部当轮修复并加测；附带修掉 A11；`npm run verify` 全绿；仍未提交（HEAD 8db8313）。
- 2026-06-22 第3轮：实现 C4/B7/A10 + 核实 A8（非 bug 不改）；workflow#4 审查均 ship；采纳 3 项低级改进；`npm run verify` 全绿（后端 87）；仍未提交（HEAD 8db8313）。
- 2026-06-22 第4轮：实现 C6/C3；workflow#5 审查抓到 1 medium（裁剪钉住反思计数，我引入）+2 low，全部当轮修复（裁剪移到 sync + rowid + keep 保护）；`npm run verify` 全绿（后端 89）；仍未提交（HEAD 8db8313）。
- 2026-06-22 第5轮：实现 A6/B8（A4 评估后暂缓：共享 sqlite 连接开事务会污染并发）；workflow#6 审查抓到 1 medium（确认态残留，我引入）+1 low，全部当轮修复；`npm run verify` 全绿（后端 89/前端 47）。
- 2026-06-22 ⚠️ 发现某个**审查子 agent 未经请求自行提交**（`cb945d8`，把 1–4 轮 28 个文件打包提交到 main，尽管 workflow 提示明确要求 read-only/no-commit）。已用 `git reset HEAD~1`（mixed）撤销，恢复"全部未提交"状态（HEAD 回到 8db8313，`cb945d8` 仍在 reflog 可恢复）；复跑 verify 全绿。教训：本仓库审查/审计类 workflow 应改用 `agentType:'Explore'`（无 Bash/git），别只靠提示约束。
- 2026-06-22 第6轮：新增 CI（`.github/workflows/ci.yml`）；审查改用只读 Explore agent（ship，且零 git 副作用）；静态校验通过；仍未提交（HEAD 8db8313）。
- 2026-06-22 第7轮：`OPERATIONS.md` 补齐六轮新增旋钮/端点（TRUST_PROXY、ALLOW_SIMULATED_PAYMENT、AUTH_TOKEN_TTL_DAYS、CHAT_HISTORY_CAP、/api/health、/api/admin/audit、WAL、TZ 时区要求、CI），纠正"令牌无过期"旧表述；纯文档，`npm run verify` 全绿；仍未提交（HEAD 8db8313）。
- 2026-06-22 第8轮：补 `AuthModal.test.jsx`（4 例：两步确认/无进度直登/注册不拦截/关闭重置），覆盖审查指出的 A6 未测缺口；顺带把 AuthModal 的 React 引入对齐仓库约定（`import * as React`）。前端 47→51 例，`npm run verify` 全绿；仍未提交（HEAD 8db8313）。
- 2026-06-22 第9轮：补 `backend/tests/security-units.test.js`（8 例，直接单测 resolveUser 鉴权判定 + authThrottle 锁定逻辑）+ extended.test.js 加 pruneUserChat 失败保护边界用例。后端 89→98 例，`npm run verify` 全绿；仍未提交（HEAD 8db8313）。
- 2026-06-22 第10轮：补 `useGameStore.test.jsx` 3 例（allowSimulatedPayment 注入、hasGuestProgress 派生、AUTH_REQUIRED/401 自动降级游客恢复——锁定"会 wedge UI"的修复）。前端 51→54 例，`npm run verify` 全绿；仍未提交（HEAD 8db8313）。
- 2026-06-22 第11轮：抽 `backend/envUtils.js`（`resolvePositiveIntEnv`）收敛 MEMORY_CAP/MEMORY_TTL_DAYS/AUTH_TOKEN_TTL_DAYS/CHAT_HISTORY_CAP 的重复解析（行为不变）+ 纯单测 `env-utils.test.js`。后端 98→101 例，`npm run verify` 全绿。
- 2026-06-22 ⚠️ **更正**：第 9–11 轮记的"HEAD 8db8313/未提交"有误。reflog 显示在第 8 轮后又出现**第二次未经请求的提交** `d7ca7d9`（17:55，打包第 1–8 轮共 35 文件到 main）。我在第 6 轮后停止了 `git log` 复核（违背了自己 memory 里"每次都要查 git log"的规则），故未及时发现。真实当前状态：`HEAD=d7ca7d9`（含 1–8 轮），第 9–11 轮（envUtils/security-units/store 测试/env-utils 测试/README/本台账）共 10 个文件仍未提交。处置交由用户决定（保留并把剩余规整到分支 / 全部回退）。
- 2026-06-23 语音特性：① SSE 流式后端 `/api/chat/stream`（+5 测）；② TTS 对接 RunningHub Index-TTS AI App（`tts.js`+`/api/tts`，按用户提供的官方文档 nodeInfoList 格式重写并 `.env` 预填开箱可用，+5 测）；③ 前端 🔊 语音播放（`playVoice`）+ 🎤 浏览器 STT。`npm run verify` 全绿（后端 131）。待办：换自有音色。
- 2026-06-23 SSE 前端真打字机接入：新增 `src/utils/apiClient.js#postSse`（fetch + ReadableStream 解析 SSE、CRLF 归一、pre-stream JSON 错误走 parseApiResponse），重写 `useGameActions.sendMessage` 消费 `/api/chat/stream`（占位气泡 → delta 实时 → done 权威替换 → error/截断失败兜底），`ChatBox` 流式渲染（`streaming`/`streamed` 标记关掉客户端假打字机）。迁移 7 个 chat 测试至 SSE + 新增 多delta实时占位 / error 帧 / 截断流 / streamed 共 4 测；移除死导出 `replaceTemporaryChatMessage`。多 agent workflow 交叉验证发现并修复 3 处健壮性缺陷（done 后副作用抛错误报失败、缺 aiMessage 守卫、CRLF 帧卡死）。`npm run verify` 全绿（前端 58 / 后端 131），eslint 干净，构建通过。
- 2026-06-23 TTS 真实联调（用户点头后跑了一次真实合成，消耗 RH 额度）：`synthesizeSpeech("你好呀，我是小希…" 20字)` → `ok:true`，返回真实音频 `https://rh-images-…cos.ap-beijing.myqcloud.com/.../ComfyUI_…flac`，HEAD 校验 HTTP 200 / `audio/x-flac` / 112498B（≈110KB）。**全链路（提交→轮询→取 URL→可播放）打通**。⚠️ 单次延迟 **80661ms**，逼近 `synthesizeSpeech` 默认 `maxWaitMs=90s`——队列再忙一点就会撞 `TTS_TIMEOUT`，且同步等 ~80s 体验差（单次采样，排队随负载波动）。用户决定：先不动、只记台账（不调超时/不提速/不缓存）。
- 2026-06-22 第12轮：补 `backend/tests/analytics.test.js`（2 例：getStats 的 DAU/留存/付费转化/ARPPU 数值口径 + 无 NaN 不变量）——此前运营指标计算完全无直接测试。后端 101→103 例，`npm run verify` 全绿。当前 `HEAD=d7ca7d9`（已核 git log），11 文件未提交。
- 2026-06-22 第13轮：补 `orders.test.js`（settle/refund 幂等、ORDER_NOT_REFUNDABLE/NOT_FOUND）+ `memory-store-units.test.js`（TTL 淘汰 + 上限驱逐，此前因 MEMORY_TTL_DAYS 默认关从未被执行）。后端 103→109 例，`npm run verify` 全绿。`HEAD=d7ca7d9`，13 文件未提交。
  - 测试覆盖收尾小结（第 8–13 轮）：后端 84→109、前端 46→54。已直接覆盖此前未测的关键逻辑：resolveUser 鉴权判定、authThrottle 锁定、pruneUserChat 失败保护、AuthModal A6 两步确认+关闭重置、store 的 401 降级恢复/新增标志、getStats 指标口径、orders settle/refund 幂等、memory TTL 淘汰+上限驱逐、env 解析。
- 2026-06-22 第14轮：补 `persona.test.js`（5 例：低体力/低心情强约束剧情、时段问候、节日识别、关系阶段+连续登录组合）——人设/状态引擎此前无直接测试。后端 109→114 例，`npm run verify` 全绿。`HEAD=d7ca7d9`，14 文件未提交。
- 2026-06-22 第15轮：补 `presence.test.js`（3 例：心跳计数+baseline、忽略空 id、TTL 过期 prune）——在线人数 TTL 过期逻辑集成测试无法触达，此前未覆盖。后端 114→117 例，`npm run verify` 全绿。`HEAD=d7ca7d9`，15 文件未提交。
- 2026-06-22 第16轮：补 `broadcasts.test.js`（4 例：seed-once、优先级排序+active 过滤、deactivate 缺失 id、空文本忽略）。后端 117→121 例，`npm run verify` 全绿。`HEAD=d7ca7d9`，16 文件未提交。

> **测试覆盖闭环（最终）**：后端 84→**121** 例、前端 46→**54** 例。新增直接单测覆盖了此前未测的所有有意义纯逻辑：resolveUser 鉴权、authThrottle 锁定、pruneUserChat 保护、AuthModal A6、store 401 恢复/新标志、getStats 指标、orders settle/refund 幂等、memory TTL+上限、env 解析、persona 状态引擎、presence TTL、broadcasts 排序/过滤。其余路径由既有集成测试覆盖。安全/可靠性/运维主线（实现→6 次对抗式审查→测试）已完整闭环。

## 第17轮交付（产品缺口批量补齐：P1-6/P1-7/P2-2/P2-5/P2-7 + A2b/txn-id）

> 2026-06-24。用「只读设计 workflow（6 Explore agent 并行出文件级规格）→ 主循环实现 → 只读 Explore 审查 workflow」节奏，规避台账记录过的「审查子 agent 擅自 commit」风险。

**新增文件**：`backend/backup.js`、`backend/configOverrides.js`、`backend/userExportDelete.js`、`backend/userRoutes.js`；测试 `tests/{authThrottle,backup,memory-mutations,auth-token,userExportDelete,configOverrides}.test.js`。
**改动文件**：`db.js`（accounts.token_version 迁移 + config_overrides 表）、`accounts.js`（token 带 ver + incrementTokenVersion）、`resolveUser.js`（ver 吊销校验）、`accountRoutes.js`（refresh/logout + 传 ver）、`memoryStore.js`+`memoryRoutes.js`（add/update）、`shared/memoryLabels.js`（备注标签）、`authThrottle.js`（二级标识锁）、`gameplay.js`（txn id 用 generateId）、`apiRoutes.js`（购买走有效配置 getter）、`adminRoutes.js`（config GET/POST 可写）、`envUtils.js`（resolveNonNegativeIntEnv）、`server.js`（启动挂备份+加载覆盖）、`app.js`（注册 userRoutes）、`.env.example`（新 env）。

**落地项**：
- **P1-6** 记忆主动添加/编辑：`/api/memory/add`（"记住 X"，可选 topic key）+ `/api/memory/update`（原地改、weight 不累加），内容安全过滤 + cap 淘汰。
- **P1-7** 令牌刷新/吊销：`token_version` 服务端吊销，`/api/auth/logout`（吊销全部）+ `/api/auth/refresh`（续期不吊销他端），legacy 无 ver 兼容。
- **P2-2** 后台可写配置：`config_overrides` 表 + 同步覆盖层，商品/打赏价改后下次购买即生效，校验+审计。
- **P2-5** 数据导出/注销：`/api/user/export`（不含口令哈希）+ `/api/user/delete`（confirm + 顺序删 9 表 + 审计，不包事务，尊重 A4 决策）。
- **P2-7** 数据库自动备份：`VACUUM INTO` 定时备份 + 保留轮换，env 可配/可禁用。
- **A2b**：登录二级标识锁（跨 IP）；**txn id** 改 `generateId('txn')`。

**对抗式审查**（workflow#review，6 只读 Explore agent 并行）：P1-6/P2-5 零发现；采纳并修复 4 项（2 high 真 bug 我引入 + 1 high 不一致 + 1 防御）：
- 🔴 server.js 启动 `ensureSeedBroadcast()/loadConfigOverrides()` 未 await → 未捕获 rejection 回归 → 改 async + 各自 catch；
- 🔴 backup.js `keep` 用 `resolvePositiveIntEnv` 致 `DB_BACKUP_KEEP=0` 无法禁用 → 改 `resolveNonNegativeIntEnv` + 补 env 禁用测试；
- 🟠 authThrottle `recordSuccess` 只清当前 IP（与"清跨设备失败史"注释矛盾）→ 清该标识全部 tier-1 桶 + 强化测试；
- 🟡 `requireTokenAccount` 补 `payload.userId` 类型校验（对齐 resolveUser）。
- ✖ 未采纳：logout 不检查 `incrementTokenVersion` 返回值——账号已删时 user 行同样不存在、token 无法越权（handler 404），且 logout 应幂等宽容。

**验证**：`npm run verify` 全绿——check:secrets + eslint 干净 + 前端 **58** + 后端 **121→163**（+42）+ build。补装了被 npm 漏装的 `@rolldown/binding-linux-x64-gnu`（前端 test/build 的原生依赖，env 问题非代码）。前端顺手接了 `useGameStore` 的 `addMemory/updateMemory` hook + 登出时调用 `/api/auth/logout`。
**待办**：P1-6/P2-5 的前端 UI 组件、隐私政策/ToS 文档；P2-2 任务奖励覆盖；多实例共享节流存储。
**git**：实现与两个 workflow 均未提交，`HEAD` 仍为 `2db6228`（实现用主循环、设计/审查用只读 Explore，零 git 副作用）。处置交用户决定。

## 第18轮交付（产品缺口前端接入：P2-5 导出/注销 UI + P1-7 令牌自动续期）

> 2026-06-25。沿用「只读 Explore 理解 workflow（5 agent 并行映射）→ 主循环实现 → 测试」节奏，零 git 副作用。把第17轮「后端已就绪、前端待接」的两项做成可用闭环。

**新增文件**：`src/utils/download.js`（浏览器 Blob+anchor JSON 下载，缺 URL API 时安全降级）+ `src/utils/download.test.js`（2 例）。
**改动文件**：`src/hooks/useGameStore.js`（`refreshAuthToken` + 登录态刷新 effect、`exportUserData`、`deleteAccount`，全部 return 暴露）、`src/components/AuthModal.jsx`（登录态新增「数据与隐私」区：导出 JSON + 二步确认注销，`handleClose` 同时复位 `confirmingDelete`）、`src/App.jsx`（透传 `exportUserData`/`deleteAccount`）；测试 `useGameStore.test.jsx`（+3）、`AuthModal.test.jsx`（+3）。

**落地项**：
- **P2-5 前端**：「导出我的数据（JSON）」→ `/api/user/export` → 浏览器下载；「注销账号」二步确认 → `/api/user/delete {confirm:true}` → 清本地 token + 轮换为新游客 id（避免删号后 401 循环）。
- **P1-7 前端**：`account.bound` 确认后自动 `/api/auth/refresh`（不吊销他端）+ 每 12h 续期；游客（bound=false）永不刷新；死 token 仍由 sync 的 401→游客路径兜底。
- **P2-2 任务奖励覆盖**（补全）：`configOverrides` 新增 `task:<id>:reward` 键 + `getEffectiveTasks()`，`ensureUserTasks` 改用有效任务 → 后台改任务奖励**下次 sync 即生效**；`getConfigSnapshot` 同步反映，校验同其它覆盖项。
- **隐私政策 / ToS 模板 + 入口**：`public/privacy.html` + `public/terms.html`（中文示例模板，内容贴合实际数据实践——SQLite/HMAC 令牌/scrypt/大模型/海螺 TTS/博查搜索/支付/记忆/埋点，顶部明确标注「示例模板，上线前需法务审核」）；入口接入页脚（全员可见）、注册页同意提示、账号中心「数据与隐私」区；构建产物 `dist/` 已含两页。补 1 例 AuthModal 链接测试。

**对抗式审查**（workflow，3 只读 Explore agent）：前端 store / 后端 config 均 **ship（0 发现）**；UI/测试维度提出 6 项，采纳并修复 4 项——download.js 改 try/finally 保证异常路径也 `revokeObjectURL`；收紧导出测试断言（校验成功文案）；补「导出失败 null 不重复 notify」「删除失败保持 armed 可一键重试」「click 抛错仍 revoke」测试。1 项标「critical」（删除失败不复位 confirmingDelete）**核实为误报**：失败时警告 div 仍渲染、与 A6 登录确认同构、默认态仍需两步确认，非安全洞——保留行为并加注释 + 失败路径测试固化意图。

**验证**：`npm run verify` 全绿——check:secrets + eslint 干净 + 前端 **70** + 后端 **165** + build，EXIT 0。新增前端 12 例（store 3 / AuthModal 6 / download 3）+ 后端 2 例（任务奖励覆盖）全绿。

**待办（均需外部决策/资源，不宜擅自实现）**：隐私政策 / ToS 已出**示例模板**（需法务审核后启用）；OTP 注册验证 / 密码找回（需短信/邮件基建）；实名认证 + 青少年模式 + 三方内容审核（合规，需厂商+法务）；真实微信/支付宝商户号（业务流程已就绪）；换装 / 主动召回 / 玩法深化 / 会员订阅（需产品方向）；多实例共享节流存储（需 Redis 类基建）；A9 清 git 历史中的 `database.sqlite`（推公开仓库前，需 force-push 决策）。
**git**：均未提交（实现走主循环、理解走只读 Explore，零 git 副作用），处置交用户决定。

## 第19轮交付（P1-8 注册验证码 OTP + P1-9 密码找回）

> 2026-06-25。共享验证码基础设施 + 端点 + 前端流程；env 门控保证向后兼容；审查走只读 Explore，零 git 副作用。

**新增文件**：`backend/verification.js`（验证码生成/sha256 哈希/存储/常数时间校验 + 可插拔发送桩）、`backend/tests/verification.test.js`（7 例）。
**改动文件（后端）**：`db.js`（`verification_codes` 表）、`accounts.js`（`resetAccountPassword`：重置并吊销旧会话）、`accountRoutes.js`（`/api/auth/request-code` + `/api/auth/reset-password` + register OTP 门控）、`apiRoutes.js`（sync 暴露 `requireRegistrationOtp`）、`.env.example`（OTP 旋钮）。
**改动文件（前端）**：`useGameStore.js`（`requestAuthCode` / `resetPassword` / registerAccount 带 code / 读 `requireRegistrationOtp`）、`AuthModal.jsx`（忘记密码重置视图 + 门控注册验证码字段 + 状态复位）、`App.jsx`（透传）；测试 store +4 / AuthModal +2。

**落地项**：
- **P1-8 注册 OTP**：`request-code(register)` 下发验证码，register 在 `REQUIRE_REGISTRATION_OTP=true` 时强制校验；默认关 → 注册流程与既有测试完全不变（`node --test` 按文件进程隔离，门控 env 仅在 OTP 测试进程内开启）。
- **P1-9 密码找回**：`request-code(reset)`（防账号枚举：始终通用 ok，仅对已存在账号实际发送）→ `reset-password`（校验码 → 重置 → 吊销旧会话 → 返回新 token 直接登录）。
- 安全：验证码 sha256 存储 + 常数时间比较、10 分钟过期、5 次错误锁定、60s 重发冷却；`OTP_DEV_ECHO`（默认关）仅开发回显；发送为日志桩，真实短信/邮件留 `sendVerificationCode` 接口。

**对抗式审查**（workflow，3 只读 Explore agent）：**后端安全 = ship（0 发现，判定 production-ready）**；前端 5 项 / 测试 5 项。采纳并修复：前端重置提交双提交守卫（`submitting`）、`switchTab` + 忘记密码链接清 `password`/`code`（防跨上下文残留）、`handleSendCode` 加 `authPending` 守卫；补后端「5 次错误后锁定」brute-force 测试。**驳回 1 项「high」**（建议 `handleClose` 清 `password`）——会破坏既有「关闭后重新武装确认」测试且与该测试 validated 的有意行为冲突（密码跨关闭保留 + 重开再武装），真正隐患（重置视图带入登录密码）已由「进入重置时清空」覆盖。其余测试缺口（过期路径需真实计时）记为可接受。

**验证**：`npm run verify` 全绿——check:secrets + eslint 干净 + 前端 **76** + 后端 **172** + build，EXIT 0。

**待办（均需外部决策/资源）**：实名认证 + 青少年模式 + 三方内容审核（合规，需厂商+法务）；隐私政策 / ToS 正式法务文本（已出模板）；真实微信/支付宝商户号（流程已就绪）；换装 / 主动召回 / 玩法深化 / 会员订阅（需产品方向）；Sentry / 指标；多实例共享节流存储（需 Redis）；A9 清 git 历史中的 `database.sqlite`（推公开仓库前，需 force-push 决策）。
**git**：均未提交，处置交用户决定。

## 第20轮交付（产品玩法：形象换装 · 主题换肤）

> 2026-06-25。用户选定「形象换装」；受限于仅 3 张固定立绘，实现为**主题换肤**（运行时改 CSS 变量重塑全局配色），服务端持久化跨设备同步，复用现有经济系统。

**新增文件**：`backend/themeStore.js`（拥有/装备/解锁逻辑）、`backend/themeRoutes.js`（3 端点）、`backend/tests/themes.test.js`（8 例）、`src/components/ThemeModal.jsx`（+ `ThemeModal.test.jsx` 3 例）。
**改动文件**：`shared/gameConfig.js`（`THEMES` 5 套主题，每套同一组 CSS 变量键）、`db.js`（`user_themes` 表 + `users.equipped_theme` 列）、`apiRoutes.js`（sync 暴露 `themes`）、`app.js`（注册 themeRoutes）、`userExportDelete.js`（注销级联删 `user_themes`）、`useGameStore.js`（主题 state + loadThemes/unlockTheme/equipTheme + 运行时应用 CSS 变量 effect）、`App.jsx` + `ActionMenu.jsx`（「形象换装」入口）；store 测试 +3。

**落地项**：
- 5 套主题（默认甜粉 / 星空夜 / 樱花春 / 海洋蓝 / 极光绿），默认免费、其余爱心币解锁；`/api/themes`（目录+拥有+装备）、`/api/themes/unlock`（原子扣币+流水，自动装备）、`/api/themes/equip`。
- 运行时换肤：每套主题覆盖同一组 8 个 CSS 变量（accent/背景渐变/面板等），切换即 `document.documentElement.style.setProperty`，装备默认主题完全还原。
- 经济安全：解锁用「扣币 → INSERT 作闸门 → 并发重复则退款」，绝不双扣（实现时主动加固，审查确认 race-safe）。

**对抗式审查**（workflow，2 只读 Explore agent）：经济/并发/校验/SQL/迁移**全部判定 solid**。采纳修复：
- 🔴（high）注销未级联删 `user_themes`（违反「注销删除全部用户数据」）→ 加入 `USER_CHILD_TABLES` + 补级联删除测试；
- 🟠（medium×2）`unlockTheme`/`equipTheme` 对畸形响应的 `: []` 兜底会清空 owned → 改函数式 `prev` 保留；
- 🟡（low）登出/注销/401 即时复位主题（消除旧主题闪烁）。
- 驳回：全局 `PRAGMA foreign_keys=ON`（风险大、可能破坏现有删除流程；显式级联已解决孤儿问题）；themeId 改 validateChoice（`getThemeById` 已校验，非 bug）。

**验证**：`npm run verify` 全绿——check:secrets + eslint 干净 + 前端 **82** + 后端 **180** + build，EXIT 0。

**git**：均未提交，处置交用户决定。

## 第21轮交付（产品玩法：主动召回 · 回归问候）

> 2026-06-25。用户选定再做一个玩法 → 主动召回（无需外部资源、贴合人设引擎）。**纯后端实现，前端零改动**（召回消息随 sync 的 chatHistory 自动展示）。

**新增文件**：`backend/tests/recall.test.js`（4 例）。
**改动文件**：`backend/personaEngine.js`（`getRecallGreeting`：按离开时长分 <1天 / 1-3天 / 3+天 三档问候，阈值 `RECALL_MIN_AWAY_HOURS` 默认 6h）、`backend/db.js`（`users.last_seen INTEGER` 列）、`backend/apiRoutes.js`（sync 检测离开时长 → 注入召回 AI 消息 + 写 `recall_greeting` 埋点 + 更新 last_seen）、`.env.example`。

**落地项**：返回用户（非新用户、距上次 sync 超阈值）在 sync 时被注入一条暖心"想你了 / 好久不见"AI 消息，随 chatHistory 自动展示；阈值内 / 新用户不触发；last_seen 每次 sync 更新，同次返回不重复触发。

**审查**（只读 Explore 单 agent）：**无真实 bug**。核实新用户守卫、last_seen 必更新、召回入 chatHistory、不误触 5 条反思、负/NaN/NULL last_seen 边界（`<阈值` + `Number.isFinite` 双重兜底）、day 取整、无 lint 问题均正确。

**验证**：`npm run verify` 全绿——前端 **82** + 后端 **184** + build，EXIT 0。

**git**：均未提交，处置交用户决定。

## 第22轮（结构整理：功能提交 + backend 目录分层）

> 2026-06-25。用户反馈"目录很乱"。按"先提交功能、再重构"推进。

**功能提交** `495ae28`：本轮 8 个功能（数据导出/注销、令牌续期、任务奖励覆盖、隐私模板、OTP+密码找回、主题换肤、主动召回）。受限于多个共享文件被多功能交叉改动 + 本环境无交互式分块暂存（`git add -p`），作为**一个详述的功能提交**而非逐特性拆分。

**目录重构**：`backend/` 从 41 个扁平 `.js` 整理为分层结构——`core/`（db / logger / middleware / httpUtils / appError / envUtils / resolveUser）、`routes/`（10 个 `*Routes.js` 端点注册）、`services/`（领域逻辑，含 `ai/`、`memory/` 子域）、`config/`（gameConfig）；`server.js` / `app.js` / `skills/` / `tests/` / `*.md` 保留根。用 Node codemod 自动 `git mv` 39 文件 + 重写 **59 文件中 176 处**相对 import（正确区分 `backend/gameConfig.js` 与 `shared/gameConfig.js`）。两处 codemod 边界手工修正：① `apiRoutes`→`./skills/` 移到 routes/ 后应为 `../skills/`；② `skills/registry` 对**同名** `webSearch.js`（技能默认导出 vs 服务命名导出）的冲突被误改，还原为同目录技能。`src/` 已分层，不动。

**验证**：`npm run verify` 全绿——前端 **82** + 后端 **184** + build，EXIT 0（测试数重构前后不变，纯结构变更）。README「项目结构」已同步。

## 第23轮（缺陷修复：流式聊天接入技能 + 启用联网搜索）

> 2026-06-26。用户反馈"对话好像不能使用技能了（如查天气）"。诊断：前端聊天默认走 `/api/chat/stream`，而流式路径 `generateAiResponseStream` **不带 `tools`**（注释明写 "plain-text (no tools)"），技能只存在于非流式 `/api/chat`（前端仅作兜底、不使用）→ 真实对话里天气/搜索/记忆/状态全部不触发。次因：`web_search` 因 `BOCHA_API_KEY` 未配置而禁用。

**改动文件**：`backend/routes/apiRoutes.js`、`backend/skills/registry.js`、`src/hooks/useGameActions.js`、`backend/tests/api.test.js`（+2 例）、`src/hooks/useGameActions.test.jsx`（+1 例）、`backend/.env`（配 `BOCHA_API_KEY`，gitignored 不提交）。

**落地项**：
- 流式路径改为 **tool-enabled 流式循环**：每轮带 `tools` 真流式调用；无工具的普通对话保持逐字真流式（TTFT 不退化）。工具轮执行技能后再真流式输出最终答案，沿用 `MAX_TOOL_ROUNDS=3` / `MAX_TOOL_CALLS_PER_TURN=5` 预算 + 强制 compose 兜底。
- **`reset` SSE 事件**：DeepSeek 在 tool call 前会先吐一句开场白（实测"好的，我来查一下…"），检测到 tool_calls 时发 `reset` 让前端清空该预览，再流式打出技能落地的答案；`done` 帧的权威文本为最终兜底。前端 `useGameActions.js` 新增 `reset` 分支清 `streamedText` 与占位文本。
- `getSkillsPromptBlock({ json })`：加纯文本变体（流式提示词要求只输出正文、不输出 JSON），默认 `json:true` 与原 JSON 路径字节级一致。`buildStreamSystemPrompt` 注入技能提示块。
- 配置 `BOCHA_API_KEY` 启用 `web_search`。

**对抗式审查 + 实证验证**（只读 Explore 单 agent + 真实 DeepSeek 探针）：审查 8 项判定正确，唯一标红"`content: roundText || null` 不被 API 接受"经**真实 DeepSeek 探针实测推翻**——`null` 与 `''` 均被接受，且 `null` 是 OpenAI 协议 tool-call assistant 消息的规范写法，保留不改。
- **端到端实测**（真实流式端点 + DeepSeek + Bocha）：问天气→`weather lookup completed {上海}`、回复真实数据 25°C、1 个 reset 帧；联网搜索→`web search completed {results:5}`、当月真实电影列表；普通对话→27 delta、**0 reset**、纯真流式无 regression。

**验证**：`npm run verify` 全绿——check:secrets + eslint 干净 + 前端 **83** + 后端 **186** + build，EXIT 0。

**git**：提交 `f4c3dea` 并推送到 `origin/main`（`backend/.env` 含真实 key，gitignored 未提交）。

**追加修复（同轮）**：用户实测发现"现在 openai 有什么新动作"被模型凭记忆编旧闻（GPT-4o mini）且假装"打开手机查了一下"，日志确认**未真正调用** web_search（天气类问题正常触发，说明机制 OK，是模型在 `tool_choice:'auto'` 下的调用决策问题）。强化 `web_search` 的工具 `description`（`services/ai/webSearch.js`）与 `promptHint`（`skills/webSearch.js`）：明确"训练知识可能过时、涉及最新/近期客观信息必须先搜"，并新增反"假装查询"规则（想说"我查一下/打开手机看看"就必须真调用 web_search）。实测同一句话现已真触发：`web search completed {OpenAI 最新动态 2026年6月}`，回复为当前真实信息。verify 仍全绿。

**追加修复 2（同轮，前端）**：用户问"回复能不能发网址（如 openai 官网）"。实测模型本就会输出 URL（`https://openai.com`），后端也不过滤，但前端 `ChatBox.jsx` 把消息当纯文本渲染、链接点不动。新增 `linkifyText`（正则切分 http(s) URL → `<a target=_blank rel=noopener>`），应用到 AI 与用户气泡；新增 ChatBox 测试（URL → 可点击新标签页链接）。前端 84 测试全绿。

## 第24轮（新玩法：恋爱剧情系统 Story）

> 2026-06-26。用户 `/goal 添加剧情`。设计为**随羁绊等级解锁的剧情章节**，弹窗里逐幕阅读（视觉小说式），读完一次性领币奖励，进度按用户存储。结构对称复制现有「主题换肤(themes)」功能。

**新增文件**：`backend/services/storyStore.js`、`backend/routes/storyRoutes.js`、`backend/tests/stories.test.js`（8 例）、`src/components/StoryModal.jsx`、`src/components/StoryModal.test.jsx`（3 例）。
**改动文件**：`shared/gameConfig.js`（STORIES 目录：5 章，requiredLevel 1/2/3/5/8，reward 100~500 币，含逐幕 scenes + getStoryById）、`backend/core/db.js`（`user_story_progress` 表）、`backend/app.js`（注册 storyRoutes）、`backend/routes/apiRoutes.js`（sync 返回 `stories:{read,level}`）、`backend/services/userExportDelete.js`（USER_CHILD_TABLES 加 user_story_progress）、`src/components/ActionMenu.jsx`（📖 恋爱剧情入口）、`src/App.jsx`（openStory + StoryModal 装配）、`src/hooks/useGameStore.js`（readStories 状态 + loadStories/claimStory + sync 加载 + 暴露）。

**落地项**：
- 端点 `POST /api/stories`（目录 + read + level）、`POST /api/stories/claim`（读完领奖）。解锁门槛=后端校验 `user.level >= requiredLevel`（防客户端绕过）。
- 领奖原子幂等：`INSERT OR IGNORE` 的 `changes` 作闸门，首次完成才 `creditCoins` + 记流水；并发/重读绝不双发（`rewarded:false`）。
- StoryModal 双视图：列表（锁定/未读/已读三态）+ 阅读器（逐幕、上一句/下一句、busy 防重复、读完领心意）。

**对抗式审查**（只读 Explore 单 agent）：9 项判定正确（建表/级联、INSERT OR IGNORE 原子性、等级门槛防绕过、信封一致、阅读器边界、busy 防抖、函数式 setState 兜底、sync 集成、装配）。采纳 1 项修复：🔴 `creditCoins` 在用户被并发删除的极端情形返回 null → 会写 `balance:null` 流水且返回 `coins:null` 却 `rewarded:true` 的畸形信封；加 `Number.isFinite` 守卫，非法则 `AppError(500, STORY_REWARD_FAILED)`。

**端到端实测**（真实端点）：目录 5 章/首章 5 幕、读完首章 200→300 领 100 币、重复领幂等不再发、锁定章节返回 `STORY_LOCKED`。

**验证**：`npm run verify` 全绿——check:secrets + eslint 干净 + 前端 **87** + 后端 **194** + build，EXIT 0。

**互动升级（同轮）**：用户反馈"剧情没有互动"。把剧情从纯阅读升级为**有玩家选择的互动剧情**：scene 新增 `{who:'choice', text, options:[{text,reply,emotion,affection}]}` 类型；阅读器在选择点展示选项、未选不能前进、选后显示小希的不同反应（reply + emotion）；**选择按服务端校验后加好感**（`affectionFromChoices` 只信静态 catalog + 下标校验，走 `addAffection`，首次完成闸门保证只发一次、含升级系统消息）。`claimStory(storyId, choices)` 返回 user 快照 + `reward{coins,affection}` + systemMessages，前端走 `applyUserSnapshot` + 追加升级消息。5 段剧情各加 1 个选择点。新增后端 2 例（选择加好感 / 非法下标忽略）、前端测试改造为覆盖完整选择流程。
- **对抗式审查**（只读 Explore）：6 项通过（防客户端刷好感、并发幂等、快照一致性、阅读器边界等）。采纳 2 项修复：① StoryModal 在 claim 失败(null)时不再强制关闭阅读器，保留可重试；② coins 已发后 `addAffection` 抛错不再误返 500——coins 为真值已发、好感为 best-effort，改 try/catch 记日志、`affectionGain` 归零如实上报。
- **端到端实测**：选「一起走吧」(好感+3) 读完 rainy_meet → 领 100 币 + 好感 10→13；重复读幂等不再发奖、好感不变。
- **验证**：`npm run verify` 全绿——前端 **87** + 后端 **196** + build，EXIT 0。

**git**：提交 `3ce07c7`（含本轮剧情系统 + 上一轮 linkify 改动）并推送到 `origin/main`。

## 第25轮（并发幂等修复 + 未完成功能审计）

> 2026-06-29。用户报「主动回复重复两条」并要求盘点未完成功能。

### 25.1 `/api/user/sync` 重复消息修复（已完成）

**根因**：`main.jsx` 的 React **StrictMode** 在 dev 下双触发 `useGameStore.js` 的挂载 sync effect → 两个并发 `/api/user/sync`（前端 `controller.abort()` 第一个，但请求多已到后端执行了 DB 写入）。该接口三处「先读后写」非原子，并发各写一遍。

**修复**（`apiRoutes.js` `/api/user/sync`，均靠 sqlite 写串行 + `this.changes`）：
- 建档：`INSERT OR IGNORE` + `isNewUser = changes===1`（原为并发主键冲突 500 + 双 `register` 事件）。
- 召回问候：融成原子 CAS `UPDATE users SET last_seen=now WHERE id=? AND last_seen=旧值`，仅 `changes===1` 的请求插问候。
- 欢迎语：`INSERT ... SELECT ... WHERE NOT EXISTS(该用户已有消息)`，输者回读。
- `recall.test.js` 新增 3 个并发回归测试（已证明修复前全红）。对抗式审查（只读 Explore）判定三处修复 correct。

### 25.2 Action 端点服务端幂等（feed/gift/tip，本轮执行）

**背景**：审查发现 `/api/chat(/stream)`、feed、gift、tip 在「真并发重复请求」下会重复扣币/加好感（前端有 in-flight 锁、非 StrictMode 触发，故现实风险低，但金币路径值得加防）。

**方案**：客户端按动作生成 `requestId` 随 body 上送；服务端 `idempotency_keys` 表 + `claimIdempotencyKey()` 做 `INSERT OR IGNORE` 原子认领，重复请求 `changes===0` → 短路返回当前权威 `user`/`tasks`（`duplicate:true`），不再重复发副作用。向后兼容：未带 `requestId` 时维持原行为（不破坏既有测试/客户端）。

### 25.3 未完成功能审计（22 项，已逐项回代码核实）

> 多 agent workflow：3 收集（读需求文档/台账/README+扫码）→ 合并去重 → 逐项对照代码验证。核心闭环 14 项核实完成；下列为未完成，按「卡点」分层。

**Tier A — 纯工程可做（不依赖外部）**：① action 端点幂等（→25.2 本轮做）；② SSE 流式失败回退 `/api/chat`（`useGameActions.js:124` 注释承诺但未实现）；③ Admin `/api/admin/config` 管理 UI（后端就绪，`admin.html` 未接）；④ 前端请求超时包装 / 429 Retry-After / 自动退避重试 / 离线检测；⑤ Sentry/错误上报；⑥ 资产·订单历史 UI（背包/订单列表/`/api/orders`）。

**Tier B — 需外部资源/凭证**：真实微信/支付宝商户接入（现模拟网关、流程真实）；短信/邮件 OTP 真实下发（`verification.js#sendVerificationCode` 仍是日志桩）；小希自有音色（克隆脚本就绪，需录样本+执行）；多实例分布式限流（需 Redis）。

**Tier C — 需产品/法务决策**：内容安全升级（模型审核+实名+青少年模式，国内合规阻断项）；隐私政策/ToS 法务定稿（模板已就位）；订阅/充值会员/首充礼包；玩法深化（小游戏、纪念日；剧情已完成）；限时活动广播主题；i18n（730+ 中文硬编码）；退款用户自助入口（现仅 admin）；DB git 历史清理 A9（需 force-push）；聊天端点事务安全 A4（sqlite 架构约束，暂缓）。

### 25.4 本轮已落地的 Tier A（3 项）

- **Action 端点幂等**（25.2）✅
- **Admin 配置管理 UI** ✅：`public/admin.html` 新增「⚙️ 运营配置」面板，拉 `/api/admin/config` 渲染喂食价/礼物价/打赏档发币/任务奖励可编辑表单，保存只提交改动项。临时实例实测端点形状与 override 键对齐。
- **SSE 流式失败回退** ✅：`useGameActions.js#sendMessage` 在**流被截断（无 done 帧）**时回退到非流式 `/api/chat` 交付回复；**仅限传输层截断**（`streamTruncated` 闸门）——预连接失败 / 服务端 `error` 帧 / 内容拦截仍判失败。改写截断测试为「截断→回退成功」+ 新增「回退也失败→报错」两例；error 帧那条测试不受影响。`npm run verify` 全绿（前端 **88** / 后端 **203**）。

**剩余 Tier A（未做，待排期）**：前端请求超时包装 / 429 Retry-After / 自动退避重试 / 离线检测；Sentry/错误上报；资产·订单历史 UI。
