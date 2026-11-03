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
| 保活，减少冷启动 | 免费实例 15 分钟无请求会休眠 | 用 https://cron-job.org 建一个每 10 分钟 GET `https://你的域名/api/health` 的任务 |
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

注册需要邮箱，找回密码通过邮件发送重置链接。在 Render → 你的服务 → **Environment** 添加：

| 变量 | 说明 | 示例 |
|---|---|---|
| `APP_URL` | 站点地址（用于拼重置链接） | `https://dividend-flow-xxxx.onrender.com` |
| `SMTP_HOST` | 邮件服务器 | `smtp.qq.com` |
| `SMTP_PORT` | 端口 | `465` |
| `SMTP_USER` | 发件邮箱 | `you@qq.com` |
| `SMTP_PASS` | **授权码**（不是登录密码） | 邮箱设置里开启 SMTP 后生成 |
| `SMTP_FROM` | 发件人（一般同 SMTP_USER） | `you@qq.com` |

> QQ 邮箱：设置 → 账户 → 开启「POP3/SMTP 服务」→ 生成授权码，用授权码作为 `SMTP_PASS`。
> 未配置 SMTP 时：注册/登录正常，找回密码会把链接输出到服务端日志（仅适合本地测试）。

## 本地开发（不部署也能跑）

```bash
cd server
npm install
npm start
```

打开 http://localhost:3000 即可。未配置 `DATABASE_URL` 时会自动使用 `server/data/db.json`（JSON 兜底），零配置。
