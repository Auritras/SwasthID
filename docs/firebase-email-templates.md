# Firebase email templates for SwasthID

These settings make Firebase's own password reset and verification emails
look like SwasthID's, at no cost. Everything here is set in the
[Firebase console](https://console.firebase.google.com), not in code.

Firebase lets you change the sender name, reply-to address and subject of
every email, plus the full message of the **password reset** email. The
**verification** email's message is fixed by Firebase to prevent spam, so
only its sender name and subject change.

## 1. The app's name

**Project settings → General → Public-facing name**: `SwasthID`

Firebase's emails use this name wherever they say `%APP_NAME%`. It is also
shown on Google sign-in.

## 2. Links open SwasthID's page

**Authentication → Templates**. Open any template with the pencil icon, click
**Customize action URL** at the bottom, and enter:

```
https://YOUR-SITE.onrender.com/auth/action
```

Use your real address. This applies to every template. Links then open
SwasthID's own page to choose a new password or confirm the email address,
instead of Firebase's plain grey page. After the change, the button on that
page leads back to the app.

## 3. Password reset

**Authentication → Templates → Password reset → pencil**

| Field | Value |
| --- | --- |
| Sender name | `SwasthID` |
| Reply to | An address you read, or leave empty |
| Subject | `Reset your SwasthID password` |

**Message:** replace it with this.

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#16323D">
  <p style="font-size:20px;font-weight:600;color:#05668D;margin:0 0 20px">SwasthID</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 12px">Hello,</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 20px">Someone asked to reset the password for the SwasthID account <b>%EMAIL%</b>. Choose a new password with the button below.</p>
  <p style="margin:0 0 24px"><a href="%LINK%" style="display:inline-block;padding:12px 24px;background:#05668D;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600">Choose a new password</a></p>
  <p style="font-size:13px;line-height:1.5;color:#4F6873;margin:0 0 8px">The link works once and expires in 1 hour. If the button doesn't work, copy this link into your browser:</p>
  <p style="font-size:12px;line-height:1.5;word-break:break-all;margin:0 0 20px"><a href="%LINK%" style="color:#0077B6">%LINK%</a></p>
  <p style="font-size:13px;line-height:1.5;color:#4F6873;margin:0">If you didn't ask for this, you can ignore this email. Your password stays the same.</p>
</div>
```

Click **Save**. To check it, use **Forgot password?** on the log-in page
with your own address.

## 4. Email address verification

**Authentication → Templates → Email address verification → pencil**

| Field | Value |
| --- | --- |
| Sender name | `SwasthID` |
| Reply to | Same as above |
| Subject | `Confirm your email for SwasthID` |

The message can't be changed here. Because it says `%APP_NAME%`, step 1
makes it say SwasthID.

## Emails landing in spam?

Firebase sends from `noreply@YOUR-PROJECT.firebaseapp.com`. Marking the first
email "Not spam" usually trains the inbox. Sending from your own domain
(Templates → **Customize domain**) needs a domain you own, which costs money,
so it is left out here.
