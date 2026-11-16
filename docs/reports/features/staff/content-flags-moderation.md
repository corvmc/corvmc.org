# Content flags / moderation

Status: ✅ /staff/moderation/flags

Members report member/band profiles from directory; anyone (Turnstile-gated, anonymous allowed) reports event listings from `/events/[id]`; staff triage queue (list + detail, resolve/dismiss with notes; event flags show event context and can also unpublish the event, notifying the band's admins). Repeat reports of an already-pending entity don't re-notify staff. Gated behind `contentFlags` flag (off by default). New flags notify all staff in-app — see `docs/decisions/0006-listings-publish-first-and-are-moderated-after.md`
