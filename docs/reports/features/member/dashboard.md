# Dashboard

Status: ✅ +page.svelte

Quick links, this week's reservations (incl. band), credit balance widget, upcoming events, pending band invitation banner, a pending action for an owned band with no other members. While `user.emailVerified` is false, a one-line notice with a resend link (`VerifyEmailNotice`, shared with the account page) follows the bands cards; `getMemberDashboard` reads the flag from the user row, not the session, whose cookie is trusted for 60s. Seeded persona: `undecided@`
