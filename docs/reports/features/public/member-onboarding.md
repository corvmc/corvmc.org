# Member onboarding

Status: ✅ Ambient, no product tour

Discoverability work from the Aug 2026 signup QA pass, deliberately without a slideshow or gated walkthrough. Join CTAs land in register mode (`?register`); login mode lives in the URL; the booking dialog preselects the first available date instead of opening on a dead end; the member nav matches the help centre (Reservations/Profile/Account/Bands; Equipment appears on its own once the catalogue holds something loanable, rather than being withheld by hand); `PageHeader` gives every authenticated page a `<title>`; help sync imports as drafts for staff review and derives category `minRole`; and a self-resolving dashboard `Alert` nudges members whose profile is still blank (`isProfileComplete` in `src/lib/server/directory/directory-service.ts`).
