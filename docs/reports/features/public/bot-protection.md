# Bot protection

Status: ✅ Cloudflare Turnstile

Gates the three public forms — sign-up (better-auth `/sign-up/email` before-hook reads `x-turnstile-token`), contact, and subscribe (remote `form()` handlers verify a `turnstileToken` field). Widget via `svelte-turnstile`; server `verifyTurnstile` helper hits siteverify. `PUBLIC_TURNSTILE_SITE_KEY` (wrangler vars) + `TURNSTILE_SECRET_KEY` (Worker secret). Falls back to Cloudflare's always-pass test keys when unset **on a local origin only** — dev, CI and the e2e preview ship blank keys on purpose; off a local origin a missing secret fails closed and reports to Sentry.
