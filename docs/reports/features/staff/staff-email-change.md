# Staff email change

Status: ✅ Full

Staff propose a member's new login email from the Account tab; it applies only when the new mailbox confirms at `/confirm-email/[token]`, which signs the member out everywhere and notifies the old address. Resend / cancel, 24-hour single-use link, five sends a day. Guarded by `user.setEmail`. See business-workflows §16
