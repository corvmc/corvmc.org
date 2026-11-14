# Event RSVP + sign-in interrupt

Status: ✅ Public page + staff list

The public event page's RSVP is one tap for a member and the sign-in interrupt for a visitor: `requiresAuth` on `Button`/`Action` links to `/login` with a validated return path and an intent label (`#lib/utils/sign-in.js`), sign-up carries the return through email verification, and `Form` treats a remote's 401 as the same interrupt. Going/undo and closed states on the page; staff see who RSVP'd (name, email, when, CSV) on `/staff/events/[id]` behind `requireListingWriter`. #1995, #1999
