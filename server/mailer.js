/* ============================================================
 * mailer.js —— 邮件发送（找回密码）
 *
 * 支持三种后端，按优先级自动选择：
 *   ① BREVO_API_KEY   → Brevo HTTP API（走 443，云服务器可用，推荐）
 *   ② RESEND_API_KEY  → Resend HTTP API（走 443）
 *   ③ SMTP_*          → 传统 SMTP（本地/自建服务器可用；Render 等云平台常屏蔽 465/587）
 *
 * 说明：云服务器（Render/阿里云等）普遍屏蔽出站 SMTP 端口，
 *       所以线上强烈建议用 ①② 这种 HTTPS API，而不是 SMTP。
 *
 * 需要的环境变量：
 *   MAIL_FROM      发件邮箱（必须是邮件服务商已验证的发件地址）
 *   BREVO_API_KEY  Brevo 的 API Key（免费 300 封/天）
 *   或 RESEND_API_KEY
 *   或 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
 *   APP_URL        站点地址（拼重置链接）
 * ============================================================ */
'use strict';

const BREVO_KEY = String(process.env.BREVO_API_KEY || '').trim();
const MAILJET_KEY = String(process.env.MAILJET_API_KEY || '').trim();
const MAILJET_SECRET = String(process.env.MAILJET_SECRET_KEY || '').trim();
const RESEND_KEY = String(process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM = String(process.env.MAIL_FROM || '').trim();

let transporter = null;

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

function backend() {
  if (BREVO_KEY) return 'brevo';
  if (MAILJET_KEY && MAILJET_SECRET) return 'mailjet';
  if (RESEND_KEY) return 'resend';
  if (smtpCfg()) return 'smtp';
  return 'none';
}
function ready() { return backend() !== 'none'; }

/** 发件地址：优先 MAIL_FROM，其次 SMTP_FROM/SMTP_USER */
function fromAddress() {
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

/* ---------------- Brevo（HTTPS，推荐） ---------------- */
async function sendViaBrevo(to, link) {
  const t = withTimeout(15000);
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: '股息流', email: fromAddress() },
        to: [{ email: to }],
        subject: SUBJECT,
        htmlContent: htmlBody(link),
        textContent: textBody(link)
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

/* ---------------- Mailjet（HTTPS，无需域名，验证发件邮箱即可） ---------------- */
async function sendViaMailjet(to, link) {
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
          Subject: SUBJECT,
          TextPart: textBody(link),
          HTMLPart: htmlBody(link)
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

/* ---------------- Resend（HTTPS） ---------------- */
async function sendViaResend(to, link) {
  const t = withTimeout(15000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `股息流 <${fromAddress()}>`,
        to: [to],
        subject: SUBJECT,
        html: htmlBody(link),
        text: textBody(link)
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
async function sendViaSmtp(to, link) {
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
      subject: SUBJECT,
      text: textBody(link),
      html: htmlBody(link)
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, err: e.message };
  }
}

async function sendResetMail(to, link) {
  const b = backend();
  if (b === 'none') {
    console.log('[mail] 未配置邮件服务，重置链接：', link);
    return { sent: false, link };
  }
  if (!fromAddress()) return { sent: false, err: '未配置 MAIL_FROM（发件邮箱）' };

  try {
    if (b === 'brevo') return await sendViaBrevo(to, link);
    if (b === 'mailjet') return await sendViaMailjet(to, link);
    if (b === 'resend') return await sendViaResend(to, link);
    return await sendViaSmtp(to, link);
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '请求超时（15s）' : (e && e.message) || String(e);
    console.error('[mail] 发送异常：', msg);
    return { sent: false, err: msg };
  }
}

module.exports = { ready, backend, sendResetMail, fromAddress };
