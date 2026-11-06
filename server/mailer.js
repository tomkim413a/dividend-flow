/* ============================================================
 * mailer.js —— 邮件发送（找回密码）
 *
 * 后端按优先级自动选择：
 *   ⓪ GMAIL_*         → Gmail API（HTTPS/443，用自己的 Gmail 账号发信）
 *                        Google 会签名，SPF/DKIM 天然通过，QQ/163 能正常收
 *   ① BREVO_API_KEY   → Brevo HTTP API（走 443，需要自有域名做认证才稳）
 *   ② MAILJET_*       → Mailjet HTTP API（免费邮箱当发件人会被 QQ 判伪造）
 *   ③ RESEND_API_KEY  → Resend HTTP API（同上，需域名）
 *   ④ SMTP_*          → 传统 SMTP（本地/自建服务器可用；Render 等云平台屏蔽 465/587）
 *
 * 结论（血的教训）：云平台屏蔽 SMTP；而且"免费邮箱地址 + 第三方代发"
 * 必然过不了 QQ/163 的 SPF/DKIM 校验。要发信只有两条路：
 *   · 自有域名并在服务商完成认证
 *   · 用邮箱服务商自己的通道发（Gmail API / Outlook Graph）——本文件的 GMAIL_* 就是这条
 *
 * 需要的环境变量：
 *   GMAIL_USER / GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
 *   或 BREVO_API_KEY / MAILJET_* / RESEND_API_KEY / SMTP_*
 *   APP_URL        站点地址（拼重置链接）
 * ============================================================ */
'use strict';

const crypto = require('crypto');

const GMAIL_USER = String(process.env.GMAIL_USER || '').trim();
const GMAIL_ID = String(process.env.GMAIL_CLIENT_ID || '').trim();
const GMAIL_SECRET = String(process.env.GMAIL_CLIENT_SECRET || '').trim();
const GMAIL_REFRESH = String(process.env.GMAIL_REFRESH_TOKEN || '').trim();

const BREVO_KEY = String(process.env.BREVO_API_KEY || '').trim();
const MAILJET_KEY = String(process.env.MAILJET_API_KEY || '').trim();
const MAILJET_SECRET = String(process.env.MAILJET_SECRET_KEY || '').trim();
const RESEND_KEY = String(process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM = String(process.env.MAIL_FROM || '').trim();

let transporter = null;
let gmailTok = { token: '', exp: 0 };

function smtpCfg() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT) || 465,
    user,
    pass,
    from: process.env.SMTP_FROM || user
  };
}

function gmailReady() {
  return !!(GMAIL_ID && GMAIL_SECRET && GMAIL_REFRESH);
}

function backend() {
  if (gmailReady()) return 'gmail';
  if (BREVO_KEY) return 'brevo';
  if (MAILJET_KEY && MAILJET_SECRET) return 'mailjet';
  if (RESEND_KEY) return 'resend';
  if (smtpCfg()) return 'smtp';
  return 'none';
}
function ready() { return backend() !== 'none'; }

/** 发件地址：Gmail 通道必须用授权账号本身（改别名会被 Google 拒发） */
function fromAddress() {
  if (backend() === 'gmail') return GMAIL_USER || MAIL_FROM;
  const c = smtpCfg();
  return MAIL_FROM || (c ? c.from : '') || (c ? c.user : '');
}

const SUBJECT = '股息流 · 重置密码';
const textBody = link => `点击下面链接重置密码（30 分钟内有效）：\n${link}\n\n如果不是你本人操作，请忽略本邮件。`;
const htmlBody = link => `<p>点击下面链接重置密码（<b>30 分钟内有效</b>）：</p>
  <p><a href="${link}">${link}</a></p>
  <p style="color:#888">如果不是你本人操作，请忽略本邮件。</p>`;

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/* ---------------- Gmail API（HTTPS，Google 签名，SPF/DKIM 天然通过） ---------------- */

/** RFC 2047 编码（主题、发件人显示名含中文时必须编码） */
function encWord(s) {
  return `=?UTF-8?B?${Buffer.from(String(s), 'utf8').toString('base64')}?=`;
}
function b64Body(s) {
  return Buffer.from(String(s), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

/** 拼一封 multipart/alternative 的 MIME 邮件（Gmail API 要求 raw 字段整封邮件） */
function buildMime({ from, to, subject, text, html }) {
  const bound = 'cf-' + crypto.randomBytes(10).toString('hex');
  const CRLF = '\r\n';
  return [
    `From: ${encWord('股息流')} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encWord(subject)}`,
    `MIME-Version: 1.0`,
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: multipart/alternative; boundary="${bound}"`,
    '',
    `--${bound}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Body(text),
    `--${bound}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Body(html),
    `--${bound}--`,
    ''
  ].join(CRLF);
}

/** 用 refresh_token 换 access_token（缓存到过期前 1 分钟） */
async function gmailAccessToken() {
  if (gmailTok.token && Date.now() < gmailTok.exp - 60000) return gmailTok.token;

  const t = withTimeout(15000);
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GMAIL_ID,
        client_secret: GMAIL_SECRET,
        refresh_token: GMAIL_REFRESH,
        grant_type: 'refresh_token'
      }),
      signal: t.signal
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      const why = j.error || `HTTP ${r.status}`;
      const tip = j.error === 'invalid_grant'
        ? '（refresh_token 已失效：多半是 OAuth 应用仍处于「测试」状态，7 天就过期；请把应用发布为「正式版」后重新获取）'
        : '';
      throw new Error(`Gmail 授权失败 ${why} ${j.error_description || ''}${tip}`.trim());
    }
    gmailTok = {
      token: j.access_token,
      exp: Date.now() + (Number(j.expires_in) || 3600) * 1000
    };
    return gmailTok.token;
  } finally { t.done(); }
}

async function sendViaGmail(to, subject, text, html) {
  const from = fromAddress();
  if (!from) return { sent: false, err: '未配置 GMAIL_USER（授权发信的那个 Gmail 地址）' };

  const t = withTimeout(20000);
  try {
    const at = await gmailAccessToken();
    const raw = Buffer.from(buildMime({ from, to, subject, text, html }), 'utf8')
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      signal: t.signal
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { sent: false, err: `Gmail ${r.status} ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } finally { t.done(); }
}

/* ---------------- Brevo（HTTPS，需自有域名认证才稳） ---------------- */
async function sendViaBrevo(to, subject, text, html) {
  const t = withTimeout(15000);
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: '股息流', email: fromAddress() },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text
      }),
      signal: t.signal
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { sent: false, err: `Brevo ${r.status} ${body.slice(0, 160)}` };
    }
    return { sent: true };
  } finally { t.done(); }
}

/* ---------------- Mailjet（HTTPS；免费邮箱当发件人会被拒收） ---------------- */
async function sendViaMailjet(to, subject, text, html) {
  const t = withTimeout(15000);
  try {
    const auth = Buffer.from(`${MAILJET_KEY}:${MAILJET_SECRET}`).toString('base64');
    const r = await fetch('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Messages: [{
          From: { Email: fromAddress(), Name: '股息流' },
          To: [{ Email: to }],
          Subject: subject,
          TextPart: text,
          HTMLPart: html
        }]
      }),
      signal: t.signal
    });
    const body = await r.text().catch(() => '');
    if (!r.ok) return { sent: false, err: `Mailjet ${r.status} ${body.slice(0, 160)}` };
    // Mailjet 即使 200 也可能单条失败，检查 Status
    try {
      const j = JSON.parse(body);
      const st = j && j.Messages && j.Messages[0] && j.Messages[0].Status;
      if (st && st !== 'success') {
        const why = (j.Messages[0].Errors || []).map(e => e.ErrorMessage).join('; ');
        return { sent: false, err: `Mailjet: ${why || st}` };
      }
    } catch (e) { /* 非 JSON 但 200 → 视为成功 */ }
    return { sent: true };
  } finally { t.done(); }
}

/* ---------------- Resend（HTTPS，需域名） ---------------- */
async function sendViaResend(to, subject, text, html) {
  const t = withTimeout(15000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `股息流 <${fromAddress()}>`,
        to: [to],
        subject,
        html,
        text
      }),
      signal: t.signal
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { sent: false, err: `Resend ${r.status} ${body.slice(0, 160)}` };
    }
    return { sent: true };
  } finally { t.done(); }
}

/* ---------------- 传统 SMTP ---------------- */
async function sendViaSmtp(to, subject, text, html) {
  const c = smtpCfg();
  if (!c) return { sent: false, err: 'SMTP 未配置' };
  try {
    if (!transporter) {
      const nodemailer = require('nodemailer');
      transporter = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465,
        auth: { user: c.user, pass: c.pass },
        connectionTimeout: 12000,
        greetingTimeout: 12000,
        socketTimeout: 15000
      });
    }
    await transporter.sendMail({
      from: `"股息流" <${c.from}>`,
      to,
      subject,
      text,
      html
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, err: e.message };
  }
}

/* ---------------- 统一发送 ---------------- */
async function sendMail(to, subject, text, html) {
  const b = backend();
  if (b === 'none') return { sent: false, err: '未配置任何邮件服务' };
  if (b !== 'gmail' && !fromAddress()) return { sent: false, err: '未配置 MAIL_FROM（发件邮箱）' };

  try {
    if (b === 'gmail') return await sendViaGmail(to, subject, text, html);
    if (b === 'brevo') return await sendViaBrevo(to, subject, text, html);
    if (b === 'mailjet') return await sendViaMailjet(to, subject, text, html);
    if (b === 'resend') return await sendViaResend(to, subject, text, html);
    return await sendViaSmtp(to, subject, text, html);
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '请求超时（15s）' : (e && e.message) || String(e);
    console.error('[mail] 发送异常：', msg);
    return { sent: false, err: msg };
  }
}

async function sendResetMail(to, link) {
  const b = backend();
  if (b === 'none') {
    console.log('[mail] 未配置邮件服务，重置链接：', link);
    return { sent: false, link };
  }
  return sendMail(to, SUBJECT, textBody(link), htmlBody(link));
}

/** 启动自检：确认凭据真的能用（Gmail 通道会真的去换一次 access_token） */
async function selfTest() {
  const b = backend();
  if (b === 'none') return { ok: false, backend: b, err: '未配置任何邮件服务' };
  if (b !== 'gmail') return { ok: true, backend: b, from: fromAddress() };
  try {
    await gmailAccessToken();
    return { ok: true, backend: b, from: fromAddress() };
  } catch (e) {
    return { ok: false, backend: b, from: fromAddress(), err: e.message };
  }
}

module.exports = {
  ready, backend, fromAddress, sendMail, sendResetMail, selfTest,
  textBody, htmlBody, SUBJECT
};
