/* ============================================================
 * mailer.js —— 邮件发送（找回密码）
 *
 * 通过 SMTP 发送，配置环境变量即可（QQ邮箱/163/腾讯企业邮/Resend SMTP 都支持）：
 *   SMTP_HOST  smtp.qq.com
 *   SMTP_PORT  465（SSL）或 587
 *   SMTP_USER  你的邮箱
 *   SMTP_PASS  邮箱授权码（不是登录密码）
 *   SMTP_FROM  发件人地址（一般同 SMTP_USER）
 *   APP_URL    站点地址，如 https://xxx.onrender.com（拼重置链接用）
 *
 * 未配置 SMTP 时：不报错，把重置链接打印到服务端日志（方便本地/内网测试）。
 * ============================================================ */
'use strict';

let transporter = null;

function cfg() {
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

function ready() { return !!cfg(); }

async function sendResetMail(to, link) {
  const c = cfg();
  if (!c) {
    console.log('[mail] 未配置 SMTP，重置链接：', link);
    return { sent: false, link };
  }
  try {
    if (!transporter) {
      const nodemailer = require('nodemailer');
      transporter = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465,
        auth: { user: c.user, pass: c.pass }
      });
    }
    await transporter.sendMail({
      from: `"股息流" <${c.from}>`,
      to,
      subject: '股息流 · 重置密码',
      text: `点击下面链接重置密码（30 分钟内有效）：\n${link}\n\n如果不是你本人操作，请忽略本邮件。`,
      html: `<p>点击下面链接重置密码（<b>30 分钟内有效</b>）：</p>
             <p><a href="${link}">${link}</a></p>
             <p style="color:#888">如果不是你本人操作，请忽略本邮件。</p>`
    });
    return { sent: true };
  } catch (e) {
    console.error('[mail] 发送失败：', e.message);
    return { sent: false, err: e.message };
  }
}

module.exports = { ready, sendResetMail };
