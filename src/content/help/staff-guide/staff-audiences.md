---
title: Build & manage audiences
slug: staff-audiences
category: staff-guide
summary: Create subscriber segments for email campaigns.
minRole: staff
sortOrder: 13
---

## Audiences

**Staff → Marketing → Audiences** holds the lists you send campaigns to. There
are two kinds, and the difference is who decides who's on them.

## Built-in audiences

Four audiences ship with the site and are marked **Built-in**:

- **All Members** — every active member account
- **Sustaining Members** — members with an active sustaining membership
- **Non-Sustaining Members** — active members without one
- **Band Leaders** — members who own or administer an active band

You don't add anyone to these. Membership is worked out from member records
every time you send, so the count is always current and there is nothing to
refresh. You can rename one or change its description, but you can't delete it,
edit its list, or open it to public signup.

Two things to keep in mind. Only people with a member account can match, so
newsletter subscribers who aren't members are never included — keep a custom
audience for those. And anyone who unsubscribes stays out until they opt back
in, even though they still match.

## Custom audiences

Create a custom audience for anything the built-ins don't cover — press
contacts, past performers, a one-off invite list.

1. Create the audience and name it.
2. Add subscribers by email, or use **Add all members** to seed it from the
   current membership. That's a one-time copy, not a live link.
3. Turn on **Allow public opt-in** if you want a signup page at
   `/subscribe/your-slug`.

## Sending

Pick any mix of built-in and custom audiences when you compose a campaign.
Anyone who appears on more than one gets a single copy.

Subscriber counts show who would actually receive the email — people who have
unsubscribed, bounced, or complained are already excluded.

## Unsubscribes

The link in an email removes someone from that one list. From that page they
can also choose **Unsubscribe from all CorvMC emails**, which stops every
campaign regardless of list — including built-in audiences they'd otherwise
keep matching. That's deliberate: someone who can't easily stop the mail hits
"mark as spam" instead, which damages delivery for everyone.

They can undo it by signing up again, on the public signup page or from their
account. Bounced and complained addresses can't be revived that way.

## Related

- Use audiences when you [send a campaign](/member/help/staff-email-campaigns).
- Members opt into public lists via the
  [newsletter](/member/help/email-subscriptions).
