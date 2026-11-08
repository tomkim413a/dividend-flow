# 股息流 · 联机版上线部署指南（免费方案 A）

> 目标：**¥0/月** 上线一个可小范围对战的联机版。
> 技术组合：Render（免费 Web 服务，托管前端 + 后端）+ Supabase（免费 PostgreSQL）+ 免费二级域名 + 自动 HTTPS。
> 你只需完成 **5 步、约 15 分钟**，其余代码与配置已就绪。

---

## 一、你只需要准备的 3 个东西

| 项目 | 用途 | 是否必须 |
|---|---|---|
| GitHub 账号 | Render 从这里拉代码 | ✅ 必须 |
| Supabase 账号 | 免费数据库 | ✅ 必须 |
| Render 账号 | 跑服务端 | ✅ 必须 |

> 三者都可以用 **GitHub 一键登录**，不需要信用卡。

---

## 第 1 步：把代码推到 GitHub（约 3 分钟）

1. 打开 https://github.com → 右上 **+ → New repository**
2. 仓库名：`dividend-flow`；Private / Public 均可；**不要**勾选 "Add a README"
3. 在本项目目录（`D:\AI Game\Dividend flow1.2.8`）打开 PowerShell，执行：

```bash
git init
git add .
git commit -m "dividend-flow 1.2.8 online"
git branch -M main
git remote add origin https://github.com/<你的GitHub用户名>/dividend-flow.git
git push -u origin main
```

> `.gitignore` 已配好：不会上传 `node_modules/`、`dist/`、`server/data/`、`.env`。
> 若提示没有 git：安装 [Git for Windows](https://git-scm.com/download/win)，一路下一步即可。

---

## 第 2 步：创建 Supabase 数据库（约 5 分钟）

1. 打开 https://supabase.com → **Start your project** → **Continue with GitHub**
2. **New project**：
   - Name：`dividend-flow`
   - Database Password：设一个强密码并**记下来**
   - Region：**Southeast Asia (Singapore)**
3. 等待 1–2 分钟初始化完成
4. 左侧 **Settings → Database → Connection string → URI**
5. **必须选 "Session pooler"**（IPv4 兼容），复制形如下面这条：

```
postgresql://postgres.xxxxxxxx:你的密码@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

> ⚠️ 不要用 "Direct connection"：免费项目直连可能只解析到 IPv6，Render 连不上。
> 这条就是后面要填的 `DATABASE_URL`。

---

## 第 3 步：Render 部署（约 5 分钟）

1. 打开 https://render.com → **Get Started** → **GitHub** 登录并授权仓库
2. 右上 **New + → Blueprint**
3. 选择仓库 `dividend-flow` → Render 会自动读取根目录的 `render.yaml`
4. 页面会要求填环境变量：
   - `DATABASE_URL`：粘贴第 2 步的 Supabase 连接串
   - `JWT_SECRET`：**保持自动生成即可**（蓝图已配 `generateValue: true`）
5. 确认配置：Plan = **Free**，Region = **Singapore**
6. 点击 **Apply / Create Web Service**
7. 等 3–5 分钟，状态变为 **Live**，拿到地址：

```
https://dividend-flow-xxxx.onrender.com
```

---

## 第 4 步：验证（2 分钟）

1. 打开上面的网址（首次可能要等 30–60 秒冷启动）
2. 点「🌐 联机对战」→ 注册账号 A → 建房，记下 6 位房间号
3. 换一个浏览器窗口打开同一网址 → 注册账号 B → 输房间号加入
4. 房主点「开局」→ 两边能同步对打 = 部署成功

页面底部若无「🌐 联机对战」按钮，说明前端没更新，强制刷新（Ctrl+F5）。

---

## 第 5 步（可选，仍然免费）

| 项目 | 作用 | 做法 |
|---|---|---|
| 保活，减少冷启动 | 免费实例 15 分钟无请求会休眠，首次唤醒 30–60 秒 | **已内置**：`.github/workflows/keep-alive.yml` 每 10 分钟 GET `/api/health`（公共仓库 Actions 免费，无需注册第三方）。推送到 GitHub 后自动生效，可在仓库 **Actions → Keep Render instance awake** 里手动 Run workflow 验证。备用：https://cron-job.org 建同样的任务 |
| 前端走 CDN | 首屏更快 | Cloudflare Pages 连同一仓库，输出目录填项目根，构建命令留空 |
| 自定义域名 | 好记 | 买域名后绑到 Render（大陆节点需备案；Render 为境外节点，免备案） |

---

## 常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 部署后 502 / 一直 Building | 依赖安装失败 | Render → Logs 看报错；确认 `server/package.json` 有 `pg` |
| 页面能开，注册报 500 | 数据库连不上 | 检查 `DATABASE_URL` 是否为 **Session pooler** 连接串；密码是否含特殊字符需 URL 编码 |
| 联机按钮点击无反应 | 前端未更新或服务未就绪 | Ctrl+F5；看浏览器 Console 有无 `socket.io` 报错 |
| 首次打开很慢 | 免费实例冷启动 | 正常现象；配 cron 保活可缓解 |
| 7 天后数据库不可用 | Supabase 免费项目无访问会暂停 | Supabase 后台点 **Restore / Resume**；或用 cron 每周访问一次 |
| 两个人无法同时进同一房间 | 用了同一账号 | 每个窗口注册不同账号（登录态按标签页隔离） |

---

## 免费额度的真实限制（务必知悉）

- Render 免费实例：**15 分钟无请求休眠**，冷启动 30–60 秒；每月 750 小时（单服务够用）
- Supabase 免费：500MB 数据库；**连续 7 天无访问会暂停**（需手动恢复）
- 免费政策可能调整，长期正式运营建议升级到最低成本 VPS（约 ¥30–70/月）
- 本方案适合 **10–50 人同时在线** 的小范围游玩

---

## 邮件服务（找回密码）

> ⚠️ 两个坑，踩过就懂：
> 1. **云服务器（Render 等）屏蔽出站 SMTP 端口（465/587）**，用 QQ 邮箱 SMTP 会一直 `Connection timeout`；
> 2. **用免费邮箱地址当发件人、经第三方服务器代发，必然过不了 QQ/163 的 SPF/DKIM 校验**，会被判伪造而丢弃——换 Brevo / Mailjet / Resend 都一样。
>
> 所以只有两条路：**用邮箱服务商自己的通道发**（下面的 Gmail API，0 元），或**买域名并完成服务商认证**。

### 推荐：Gmail API（**完全免费**，HTTPS 443，Google 签名，QQ/163 能收）

> **费用**：Gmail API 标准用量 0 元，**不需要绑信用卡或结算账号**。个人 Gmail 免费，每天约 500 封。
> 只有用 Google Workspace 企业邮箱、或开放给 >100 个外部用户去做官方验证时才可能产生费用，本项目用不到。

代码已支持，只需 4 个环境变量。获取方法（需登录 https://console.cloud.google.com）：

> 新版控制台叫 **Google Auth Platform**（原「OAuth 同意屏幕」），分 `Branding` / `Audience` / `Data Access` / `Clients` 四个页签；
> 旧菜单 `API 和服务 → OAuth 同意屏幕` 会跳到同一处。

1. 顶部项目下拉 → **New Project** → 名称如 `dividend-mail` → Create，并确认顶部已切换到新项目
2. **API 和服务 → 库** → 搜 `Gmail API` → **Enable**（漏了最后必报 403）
3. **Google Auth Platform → Get started** 四步向导：应用名 + 支持邮箱 → Audience 选 **External** → 联系邮箱 → 同意政策 → Create
4. **Data Access → Add or remove scopes** → 用底部「手动添加范围」粘贴 `https://www.googleapis.com/auth/gmail.send` → Update / Save
   （只加这一个；不要加 `gmail.modify` / `gmail.readonly`）
5. **Audience**：Test users 加你自己的 Gmail；然后 **Publish app → Confirm**，状态必须显示 **In production**。
   ⚠️「测试」状态签发的 refresh_token 只有 7 天寿命。单人自用不需要提交 Google 验证，授权时出现「未验证应用」是正常的，点 **高级 → 继续**。
   若 Publish 按钮灰色，先在 Branding 填 App homepage / Privacy policy 为 `https://dividend-flow.onrender.com`
6. **Clients → Create client** → 应用类型选 **Desktop app / 桌面应用** → 记下 Client ID 与 Client secret（桌面应用无需填回调地址）
7. **发布之后**再跑一次性授权脚本（顺序不能反，否则拿到的还是 7 天 token）：

```bash
node tools/gmail-token.js --id <客户端ID> --secret <客户端密钥>
```

8. 脚本会打印一段环境变量，复制到 **Render → 服务 → Environment**（这些变量不在 `render.yaml` 里，需手动添加）：

| 变量 | 值 |
|---|---|
| `APP_URL` | `https://dividend-flow.onrender.com`（结尾不要 `/`） |
| `GMAIL_USER` | 你授权的 Gmail 地址 |
| `GMAIL_CLIENT_ID` | 第 6 步的客户端 ID |
| `GMAIL_CLIENT_SECRET` | 第 6 步的客户端密钥 |
| `GMAIL_REFRESH_TOKEN` | 第 7 步脚本打印的 refresh_token |
| `ADMIN_TOKEN` | 自定义长随机串，用于 `/api/mail/diag` 自检 |
| `MAIL_ENABLED` | **确认能收到信之后**再设 `true`，用于开放玩家的邮箱找回入口 |

> ⚠️ **邮件找回默认对玩家隐藏**：`MAIL_ENABLED` 未开启时，`/api/forgot` 会明确返回
> 「邮件找回暂未开放」，登录框也不显示「改用邮箱」入口 —— 避免出现「提示已发送但被
> QQ/163 拒收」的假成功（这正是本项目最初的故障）。忘记密码统一走密保问题自助重置。
> 配好邮件后先用 `POST /api/mail/diag` 真发一封到自己邮箱确认收到，再加 `MAIL_ENABLED=true`。

9. 部署后日志应出现：

```
[mail] 邮件服务：gmail，发件人=你@gmail.com
[mail] 通道自检通过（gmail）
```

若出现 `[mail] 通道自检失败：Gmail 授权失败 invalid_grant` → 应用还在"测试"状态（7 天过期），发布为正式版后重跑第 7 步；若已是正式版，则是 6 个月未使用过期，同样重跑脚本即可。服务端已用 `/api/health` 每 3 天自动保活凭据，正常不会再触发。

> 想验证是否真的能发：调用 `POST /api/mail/diag`（请求头 `x-admin-token`，body `{"to":"你的QQ邮箱"}`），会真的发一封测试信并返回服务商原始结果。

### 备选：自有域名 + Brevo（免费 300 封/天）

1. 注册 https://www.brevo.com → **SMTP & API → API Keys** 创建 Key
2. **Senders, Domains & IPs → Domains** 添加你的域名，按提示在 DNS 加 SPF / DKIM / Brevo 验证记录
3. Render 填 `MAIL_FROM=no-reply@你的域名`、`BREVO_API_KEY=...`、`APP_URL=...`

### 传统 SMTP（仅本地/自建服务器）

`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`。云上使用会超时，不建议。

> 未配置邮件服务时：注册/登录正常，**用户仍可用「密保问题」自助重置密码**（注册时必填），因此忘记密码功能不会完全失效。

## ⚠️ 数据库必须配置（否则账号会丢）

Render 容器磁盘是临时的，**不配 `DATABASE_URL` 时**服务端会退回 JSON 文件存储，每次部署/重启/休眠唤醒都会清空账号与战绩。

启动日志出现 `[db] mode = json` 就说明没配好；正确应为：

```
[db] mode = postgres
```

## 本地开发（不部署也能跑）

```bash
cd server
npm install
npm start
```

打开 http://localhost:3000 即可。未配置 `DATABASE_URL` 时会自动使用 `server/data/db.json`（JSON 兜底），零配置。
