# Inbox Reply Setup

Turning on threaded email replies for the unified staff inbox: the DNS, Postmark, and secret
configuration that lets a reply to one of our emails land back on the conversation it came from.

> A **one-time enablement runbook**. For what the mechanism is and how it fits the rest of the
> system see the [operations manual](operations-manual.md); for the code path and its failure
> modes see [business-workflows](../development/business-workflows.md).

---

## What this turns on

The inbox sends and receives either way — the route, the signing, and the threading are always
built. What this configures is the address that connects them. Every difference below follows from
the single `INBOX_REPLY_ADDRESS` variable:

|                                                | `INBOX_REPLY_ADDRESS` unset                                             | Configured                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `Reply-To` on a staff inbox reply              | `STAFF_CONTACT_EMAIL` (`contact@corvmc.org`)                            | `reply+<threadId>.<sig>@replies.corvmc.org`                    |
| The contact answers that email                 | Lands in the `contact@` mailbox, attached to no thread                  | Files onto the original thread; reopens it if resolved         |
| `Reply-To` on the contact-form staff alert     | The submitter's own address                                             | The signed thread address                                      |
| Staff answer that alert from their mail client | Goes straight to the submitter, **not recorded**                        | Relayed to the submitter _and_ recorded as an outbound message |
| Wording in the alert                           | "…your reply goes straight to them and is NOT saved to the staff inbox" | "…sent from CMC and saved on the conversation"                 |

The unset state is deliberate and safe: every reply still reaches a human, nothing bounces, and
nothing is lost. It simply isn't on the record. That is what the app falls back to before this is
configured, and what [rollback](#rollback) returns it to.

> **Status:** steps 1–4 were completed on 2026-08-19 — the MX is live, the secrets are set, and
> `INBOX_REPLY_ADDRESS` is uncommented in `wrangler.toml`. It reaches production on the next
> deploy of `main`. Keep this runbook for staging, for re-enablement after a rollback, and for
> the troubleshooting table.

## Prerequisites

- [ ] `wrangler login`, with access to the `corvmc` Worker and the `corvmc.org` zone
- [ ] Admin on the Postmark server that `POSTMARK_SERVER_TOKEN` belongs to
- [ ] The `inbox-reply` template exists **on that server** (see below)
- [ ] `POSTMARK_TRANSACTIONAL_STREAM` names a stream that actually exists on that server. There
      is no fallback — every send throws when it doesn't.

Nothing in the code preflights the template, and a missing alias surfaces only as a failed send in
Sentry (`event: email.send`), so check it explicitly. This renders every template through Postmark
and sends nothing:

```bash
pnpm email:validate
```

If `inbox-reply` is absent, push it. The CLI reads the shell, not `.env`:

```bash
export POSTMARK_SERVER_TOKEN=... && pnpm email:push
```

**Not covered here.** SPF, DKIM, DMARC, and the Postmark sender signature govern _outbound_
deliverability from `corvmc.org`. They are unrelated to receiving mail; inbound MX works without
them.

---

## 1. Cloudflare DNS

### Check Email Routing first

Cloudflare dashboard → `corvmc.org` → Email → Email Routing. It must be **off**. When enabled it
claims the zone's MX records wholesale, which both overwrites the record below and is the more
dangerous half of the footgun in the warning further down.

### Add the MX record

DNS → Records → Add record:

| Field       | Value                     |
| ----------- | ------------------------- |
| Type        | `MX`                      |
| Name        | `replies`                 |
| Mail server | `inbound.postmarkapp.com` |
| Priority    | `10`                      |
| TTL         | Auto                      |

MX records are never proxied, so there is no orange cloud to think about.

> **Never add or change an MX record on `corvmc.org` itself.** `contact@corvmc.org` is a live
> mailbox — pointing the apex at Postmark black-holes real mail. The record above is on the
> `replies` subdomain, which exists for nothing else.

Confirm before moving on. This is the one step with propagation delay:

```bash
dig MX +short replies.corvmc.org
```

→ `10 inbound.postmarkapp.com.`

```bash
dig MX +short corvmc.org
```

→ whatever it was before you started. If this one now says `inbound.postmarkapp.com`, stop and
revert it.

## 2. Postmark server settings

Postmark → Servers → the CMC server → the **Inbound** stream → Settings.

1. **Inbound domain forwarding** → `replies.corvmc.org`
2. **Inbound webhook URL** →

   ```
   https://postmark:<POSTMARK_INBOUND_TOKEN>@corvmc.org/api/inbox/postmark
   ```

   Substitute the value from step 3 — generate it first if you haven't.

The credential rides in the URL because it has to. Postmark's "up to 30 custom headers" feature
belongs to _modular_ (message-event) webhooks; the inbound hook is a bare `InboundHookUrl` that
can carry only HTTP Basic. The username half is ignored — `src/routes/api/inbox/postmark/+server.ts`
reads the password. It also accepts an `x-postmark-token` header, which exists for local `curl`
testing and is used in step 5.

Leave "Include raw email content" off; the handler reads the parsed payload.

## 3. Secrets

```bash
openssl rand -hex 32
wrangler secret put POSTMARK_INBOUND_TOKEN
wrangler secret put INBOX_REPLY_SECRET
```

`POSTMARK_INBOUND_TOKEN` must match the password in the hook URL from step 2. **The route rejects
every inbound request while this is unset** — that is its default-deny, not a misconfiguration.

`INBOX_REPLY_SECRET` is nominally optional; `reply-address.ts` falls back to
`POSTMARK_SERVER_TOKEN`. **Set it anyway, with its own random value.** The signature in every
reply address derives from this secret, so on the fallback path, rotating the Postmark token —
something you would do for entirely unrelated reasons — silently invalidates every reply address
already sitting in members' and staff's mailboxes. Their replies then arrive as brand-new threads.
Giving the signature its own secret decouples the two, and it costs one `openssl` invocation.

Treat it as append-only afterwards: rotating `INBOX_REPLY_SECRET` has that same effect.

## 4. Deploy the address — last

Uncomment this line in `wrangler.toml` (near line 98) and deploy:

```toml
INBOX_REPLY_ADDRESS = "reply@replies.corvmc.org"
```

**Order matters.** This is the switch, which is why it goes last. The moment it ships, replies are
addressed to `replies.corvmc.org` — if the MX from step 1 is not yet resolving, every one of them
bounces and the safe fallback you had is gone.

The local part can be anything: `buildReplyToAddress()` splits on the last `@` and inserts
`+<threadId>.<sig>` before it. The domain must be the one carrying the MX record.

## 5. Verify

Each check fails at a different layer, so run them in order — the first failure names the step to
revisit.

**1. DNS.** Both `dig` commands from step 1.

**2. Inbound auth, no mail involved.** A wrong token must be refused:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://corvmc.org/api/inbox/postmark \
  -H 'content-type: application/json' -H 'x-postmark-token: definitely-wrong' \
  -d '{"From":"probe@example.com","TextBody":"probe"}'
```

→ `401`. Then use **Check** on Postmark's inbound webhook settings to send a real test payload
with the correct credential → `200`.

**3. Outbound shape.** Reply to any open thread from `/staff/inbox/<id>`, then find that message
in Postmark → Activity. It should carry `Reply-To: reply+<uuid>.<12 chars>@replies.corvmc.org`,
`Tag: inbox-reply`, and `Metadata: threadId=<uuid>`. A `Reply-To` of `contact@corvmc.org` means
step 4 hasn't deployed.

**4. Round trip.** Answer that email from an external mailbox — not a staff address, for the
reason in step 5. It must appear on the **same** thread, and the thread must keep its original
channel: a contact-form thread stays `web`, it does not become `email`.

**5. Relay.** Submit the public contact form, then have a staff member reply to the alert from
their own mail client. The submitter receives it _from CMC_, and it lands on the thread as an
outbound message attributed to that staffer.

That last check is worth doing deliberately. It is the only one that exercises
`findStaffUserByEmail`, which is the sole reason a staff member's own words get relayed to the
contact rather than filed as if the contact had written them.

## Rollback

Re-comment `INBOX_REPLY_ADDRESS` and deploy. Replies revert to `Reply-To: STAFF_CONTACT_EMAIL`
immediately and nothing bounces. Leave the MX record and both secrets in place — they are inert
without the address, and removing them buys nothing.

The one cost: reply addresses already in the wild stop resolving, so a late reply to a message
sent before the rollback opens a new thread instead of threading into its own. Rotating
`INBOX_REPLY_SECRET` does the same thing.

## Troubleshooting

Read this by symptom.

| Symptom                                                            | Cause                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The contact receives a **blank branded email**                     | The `inbox-reply` template has a layout attached on the server while its own `HtmlBody` is empty (it is text-only — there is no `content.html`). Postmark renders the layout wrapped around nothing, and mail clients prefer that HTML part over the correct text one. `pnpm email:validate` now checks this; detaching needs `{"LayoutTemplate": ""}` — both the CLI and the API ignore `null`. |
| `Reply-To` is still `contact@corvmc.org` after deploying           | `INBOX_REPLY_ADDRESS` is unset or malformed. `buildReplyToAddress()` returns `null` when the value has no `@`, or the `@` is the first or last character.                                                                                                                                                                                                                                        |
| Postmark's inbound activity shows repeated `401`s                  | `POSTMARK_INBOUND_TOKEN` is unset on the Worker, or doesn't match the password in the hook URL. Both read as the same `401`.                                                                                                                                                                                                                                                                     |
| A reply opens a **new** thread instead of threading                | The signature didn't verify. Check the new message's `channel_metadata.unresolvedMailboxHash`: present means an address arrived but failed the HMAC (the secret changed since it was sent); absent means the plus-address never survived — some clients and forwarders rewrite it.                                                                                                               |
| A staff member's reply is filed as though the **contact** wrote it | That sender address isn't on a staff or admin user record. `findStaffUserByEmail` matches the exact address, so a staffer replying from a personal alias isn't recognised.                                                                                                                                                                                                                       |
| A staffer's reply wasn't relayed, and they are the thread contact  | Deliberate. Relaying would mail them their own words, and their reply to that would relay again.                                                                                                                                                                                                                                                                                                 |
| No reply was delivered; an internal note appeared instead          | Either the body was empty after quote-stripping, or the send failed — look for `inbox.relay_failed` in Sentry. The note carries the full text so it can be re-sent from the composer.                                                                                                                                                                                                            |
| An out-of-office autoreply landed in a thread                      | `isAutoResponse()` skips `Auto-Submitted`, `X-Autoreply`, and `Precedence: bulk\|auto_reply`. A vacation responder that sets none of those is indistinguishable from a person.                                                                                                                                                                                                                   |
| A reply to a member↔member DM does nothing                         | By design. `direct` threads are dropped: nothing we send carries a reply address for one, so anything arriving with one is misrouted or forged.                                                                                                                                                                                                                                                  |
| Postmark logs `200` but nothing appears in the inbox               | The handler swallows its own errors so Postmark never retries. Sentry is the only signal — the `200` proves delivery, not success.                                                                                                                                                                                                                                                               |

One thing that is **not** a cause: the `email` channel toggle (Staff → Settings → Inbox Channels).
It gates only mail from a sender we have no thread with. A signed reply always lands, because we
invited it — so if a reply is missing and the toggle happens to be off, the toggle is a red
herring and the real problem is the signature.
