// Account emails (password reset, email verification) sent by our own server
// through any SMTP account, e.g. a Gmail app password or Brevo's free plan.
// Without SMTP settings the app falls back to Firebase's default emails.

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
// true for port 465 (TLS from the start); 587 upgrades with STARTTLS.
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
// Shown as the sender, e.g. "SwasthID <yourname@gmail.com>".
const MAIL_FROM = process.env.MAIL_FROM || '';

let transport = null;

function configured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_FROM);
}

function getTransport() {
  if (!transport) {
    transport = require('nodemailer').createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      // Local test mail servers use plain connections.
      ignoreTLS: SMTP_HOST === '127.0.0.1' || SMTP_HOST === 'localhost'
    });
  }
  return transport;
}

async function send({ to, subject, html, text }) {
  if (!configured()) throw new Error('SMTP is not configured.');
  return getTransport().sendMail({ from: MAIL_FROM, to, subject, html, text });
}

// Render's free plan blocks these ports: each email would wait for the
// connection to time out before the app falls back to Firebase's email.
if (configured() && process.env.RENDER && [25, 465, 587].includes(SMTP_PORT)) {
  console.warn(`WARNING: SMTP port ${SMTP_PORT} is blocked on Render's free plan. Unless this is a paid instance, remove the SMTP_* settings; Firebase will send the account emails.`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// One layout for both emails: tables and inline styles, because many mail
// apps ignore <style> blocks and modern CSS.
function layout({ origin, preheader, heading, intro, button, url, note, footer }) {
  const font = "Lexend, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const link = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#E6F0F3;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E6F0F3;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
    <tr><td style="padding:0 4px 20px;font-family:${font};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;"><img src="${escapeHtml(origin)}/assets/icon-192.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></td>
        <td style="vertical-align:middle;padding-left:10px;font-family:${font};font-size:19px;font-weight:600;color:#05668D;">SwasthID</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#FFFFFF;border-radius:14px;border:1px solid #D3E3E8;padding:32px 28px;font-family:${font};color:#16323D;">
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:600;color:#0B2A36;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${intro}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border-radius:10px;background:#05668D;">
          <a href="${link}" style="display:inline-block;padding:13px 26px;font-family:${font};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(button)}</a>
        </td>
      </tr></table>
      <p style="margin:24px 0 6px;font-size:13px;line-height:1.5;color:#4F6873;">${escapeHtml(note)}</p>
      <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#4F6873;">If the button doesn't work, copy this link into your browser:</p>
      <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${link}" style="color:#0077B6;">${link}</a></p>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${font};font-size:12px;line-height:1.5;color:#5B727C;text-align:center;">
      ${escapeHtml(footer)}<br>
      <a href="${escapeHtml(origin)}/" style="color:#5B727C;">${escapeHtml(origin.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function passwordResetEmail({ email, url, origin }) {
  const subject = 'Reset your SwasthID password';
  const html = layout({
    origin,
    preheader: 'Choose a new password for your SwasthID account.',
    heading: 'Reset your password',
    intro: `Someone asked to reset the password for the SwasthID account <b>${escapeHtml(email)}</b>. Choose a new password with the button below.`,
    button: 'Choose a new password',
    url,
    note: 'The link works once and expires in 1 hour.',
    footer: "If you didn't ask for this, you can ignore this email. Your password stays the same."
  });
  const text = [
    'Reset your SwasthID password',
    '',
    `Someone asked to reset the password for the SwasthID account ${email}.`,
    'Open this link to choose a new password (it works once and expires in 1 hour):',
    '',
    url,
    '',
    "If you didn't ask for this, you can ignore this email. Your password stays the same."
  ].join('\n');
  return { subject, html, text };
}

function verificationEmail({ email, url, origin }) {
  const subject = 'Confirm your email for SwasthID';
  const html = layout({
    origin,
    preheader: 'One click to finish setting up your SwasthID account.',
    heading: 'Confirm your email address',
    intro: `Welcome to SwasthID. Confirm that <b>${escapeHtml(email)}</b> is your address, then log in to start your health record.`,
    button: 'Confirm email address',
    url,
    note: "If the link has expired, log in and we'll send you a new one.",
    footer: "If you didn't create a SwasthID account, you can ignore this email."
  });
  const text = [
    'Confirm your email for SwasthID',
    '',
    `Confirm that ${email} is your address by opening this link, then log in:`,
    '',
    url,
    '',
    "If you didn't create a SwasthID account, you can ignore this email."
  ].join('\n');
  return { subject, html, text };
}

module.exports = { configured, send, passwordResetEmail, verificationEmail };
