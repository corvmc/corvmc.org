# Invite member

Status: ✅ Full

**Invite member** on `/staff/members` emails somebody with no account a sign-up link, optionally placing them in clubs or committees as `group_invite` rows that seat them on sign-up (one email, not one per group). An address with an account or a live pending invite gets no email. Every invite is a `member_invite` row: the Members **Invited** status (`/staff/members?status=invited`, `user.invite`) lists them by status with Resend and Revoke; revoking also revokes its group invites. Sign-in marks the address's invite accepted. Any signed-in member can **Invite a friend** from the dashboard, with no groups and capped at `MEMBER_INVITE_DAILY_LIMIT` (5) a day, and gets the same answer whatever the address. #1830 #2030
