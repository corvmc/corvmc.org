---
title: Import a Club or Committee Roster
slug: staff-roster-import
category: staff-guide
summary: Turn a list of email addresses, such as a Zeffy export, into club or committee membership in one step.
minRole: staff
capabilities: group.manage
sortOrder: 22
---

Open the club under **Staff → People → Clubs**, or the committee under **Staff → Planning →
Committees**, and choose **Import emails** on the **Roster** card.

## What to give it

- **Paste addresses** one per line, or separated by commas or semicolons.
- **Or choose a CSV.** A Zeffy export works as it is: the column whose header says "email" is
  used and every other column is ignored.

You can do both at once. Capitalisation and repeats do not matter. One import takes up to 500
addresses; split a longer list.

## What happens to each address

- **Has an account:** added to the roster straight away as a member. There is nothing for them
  to accept. An invitation or application they already had for this group is settled at the
  same time. They are told: a "You've been added to …" notification goes to them in the app and
  by email, following their notification settings, with a link to the group.
- **No account:** emailed the usual invitation to create an account and join. The link is good
  for 7 days.

## The results

When the import finishes, an **Import results** card above the roster lists every address under
one of:

- **Added**: had an account, now a member.
- **Invited**: no account, invitation emailed.
- **Already members**: left as they were, and not notified.
- **Already invited**: their invitation is still live, so it was not sent again.
- **Invalid**: not an email address, or the account is deactivated. Fix these lines and import
  them again.

Choose **Show addresses** under any count to see who it was. The card goes away when you leave
the page or choose **Dismiss**. The import is also recorded in the audit log.
