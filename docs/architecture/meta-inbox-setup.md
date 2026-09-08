# Meta Inbox Setup

Turning on Instagram DMs and Facebook Messenger as staff-inbox channels: the Meta app, the
permissions, the Page subscription, and the secrets that let a DM open a thread and a staff reply
reach the person who sent it.

> A **one-time enablement runbook**. For what the mechanism is and how it fits the rest of the
> system see the [operations manual](operations-manual.md); the code lives in
> `src/lib/server/inbox/meta-client.ts` and `src/routes/api/inbox/meta/+server.ts`.

---

## What this turns on

The code is always built: the webhook route, the signature check, the echo handling, the dedupe
and the outbound dispatch all exist whether or not any of this is configured. What this runbook
adds is a Meta app that will actually talk to them, and a toggle flipped at the end.

|                                 | Channels off (today)                    | Configured and on                                                                       |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| A DM arrives                    | Webhook answers `{ ok: true, skipped }` | Opens or continues a thread, keyed on the sender's PSID/IGSID                           |
| Thread title                    | —                                       | The contact's display name, looked up once on first contact                             |
| A photo or story reply arrives  | —                                       | Files with a `[Photo]` / `[Replied to your story]` body                                 |
| Staff reply from `/staff/inbox` | Composer shows "channel is disabled"    | Delivered by the Graph API; refused past 7 days, and the composer says so               |
| Staff reply from the IG app     | —                                       | Arrives as an echo and files as **outbound**, so the thread stops reading as unanswered |

The off state is deliberate and safe. Nothing bounces and nothing is lost, because nothing is
subscribed — Meta has nowhere to send. That is what [rollback](#rollback) returns it to.

> **Status:** not provisioned. Both channels are off in production and in the dev seed. The
> gating item is Meta's app review, which is measured in days to weeks — see step 1.

## Prerequisites

Work through these before touching the app; each of the first three is a hard block that Meta
will not let you past, and the fourth is the one that silently does nothing.

- [ ] A **Facebook Page** for CMC, with an admin who can grant app access
- [ ] **Business verification** completed for the Meta business the app belongs to
- [ ] The Instagram account converted to a **Professional** account and **linked to that Page**
- [ ] The app uses **Facebook Login for Business**, not Instagram Login

That last one decides which API you are on, and getting it wrong produces no error — just an
integration that never delivers. `sendMetaMessage` posts to `graph.facebook.com/…/me/messages`
with a Page token, which reaches an Instagram Professional account **only** when it is linked to
the Page under Facebook Login for Business. The other flavour, Instagram Login, speaks to
`graph.instagram.com` with a token of its own and would need a second code path. If someone
connects the account that way, Instagram messages will simply never send and nothing in the app
will say why.

**Not covered here.** The `web`, `email` and `sms` channels are independent; see
[inbox-reply-setup](inbox-reply-setup.md) for the email side.

---

## 1. Meta app and permissions

Create an app in the Meta developer console (type: Business) and request these, all at **Advanced
Access** — Standard Access only reaches accounts with a role on the app, which is enough to test
with and not enough to serve the public:

| Permission                           | What breaks without it                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `pages_messaging`                    | Messenger send and receive                                                     |
| `instagram_business_manage_messages` | Instagram send and receive                                                     |
| `pages_manage_metadata`              | Subscribing the app to the Page's webhooks (step 3)                            |
| `pages_read_engagement`              | The profile lookup that names a thread                                         |
| Human Agent                          | Replying between 24 hours and 7 days — see [the window](#the-messaging-window) |

Advanced Access requires app review, with a screencast of the integration in use. Submit early:
this is the long pole, and everything else here takes an afternoon.

## 2. Page and Instagram linkage

In the app, add the Messenger and Instagram products and connect the CMC Page. Confirm the
Instagram account shows as linked on the Page's own settings, not just in the app — the app will
list it either way.

## 3. Webhook subscription

Point the app's webhook at:

```
https://corvmc.org/api/inbox/meta
```

with the verify token you will set as `META_VERIFY_TOKEN` below. Meta calls `GET` with
`hub.challenge` and expects it echoed; the route does that and answers `403` on any mismatch,
including when the token is unset.

Subscribe these fields, for both the `page` and `instagram` objects:

- `messages`
- `message_echoes`

`message_echoes` is not optional. It is how a DM answered from someone's phone reaches the
thread, and without it that conversation keeps reading as unanswered and keeps sitting in the
queue. (Our own dispatched replies echo back too; they are deduped by `mid`.)

Deliberately **not** subscribed: `messaging_postbacks`, `message_reactions`, `comments` and
`mentions`. The first three are skipped by `normalizeMetaEvent` anyway. Comments and mentions
arrive on `entry[].changes[]` rather than `entry[].messaging[]` — a comment is a public post on a
piece of content, not a conversation, and filing it in the queue would attribute it to a contact
who never wrote to us.

Then subscribe the app to the Page:

```bash
curl -X POST "https://graph.facebook.com/v21.0/<page-id>/subscribed_apps" \
  -d "subscribed_fields=messages,message_echoes" \
  -d "access_token=<page-access-token>"
```

## 4. Secrets

Three, all Worker secrets — there is no `wrangler.toml` half to this.

| Secret                   | Where it comes from                                    |
| ------------------------ | ------------------------------------------------------ |
| `META_APP_SECRET`        | App settings → Basic. Verifies `x-hub-signature-256`.  |
| `META_VERIFY_TOKEN`      | Any random string. Must match what step 3 was given.   |
| `META_PAGE_ACCESS_TOKEN` | A **Page** token derived from a long-lived user token. |

Get a never-expiring Page token rather than the 1-hour one the Graph Explorer hands out by
default: exchange the short-lived user token for a long-lived one, then read the Page token off
`/me/accounts` using it. A Page token obtained that way survives until the granting admin changes
their password or removes the app.

There is **no refresh path in the code**. That is a deliberate trade — the token is one secret
rather than an OAuth flow with its own tables — and the cost is that an expired token does not
announce itself: replies simply start failing on a channel nobody is watching. Staff → Settings →
Inbox Channels has a **Test connection** button on both Meta cards for exactly this. Use it after
setting the secret, and again whenever a reply fails for no visible reason.

```bash
pnpm exec wrangler secret bulk .secrets.json
```

`secrets.template.json` already lists all three.

## 5. Enable the channels — last

Staff → Settings → Inbox Channels, toggle Instagram and Messenger on.

Do this **after** steps 1–4, not before. The toggle is checked at the top of the webhook route, so
while it is off an early or misconfigured delivery is answered `{ ok: true, skipped }` and
discarded — which is what you want during setup, and is also why a forgotten toggle looks
identical to a webhook that was never subscribed.

## 6. Verify

In order, because each step depends on the one before:

1. **Handshake.** In the app's webhook settings, press Verify. A `403` means `META_VERIFY_TOKEN`
   is unset on the Worker or does not match.
2. **Inbound.** DM the Page from a personal account. A thread appears in `/staff/inbox` under the
   Instagram or Messenger icon, titled with your display name — not a long number. A number means
   the profile lookup failed; check `pages_read_engagement`.
3. **A non-text message.** Reply to one of the Page's stories, or send a photo. It files as
   `[Replied to your story]` / `[Photo]`, with the payload on the message's `channelMetadata`.
4. **Outbound.** Reply from the thread. It arrives in the app within seconds.
5. **Echo.** Answer the same conversation from the Instagram or Messenger app on a phone. It
   appears in the thread as an outbound message from "Sent from Instagram", and the thread stops
   showing as awaiting a reply. If it appears as **inbound**, `message_echoes` is subscribed but
   something is wrong with the echo path — that is the failure mode this whole integration was
   rewritten to prevent, and it is worth stopping to fix.
6. **Dedupe.** Reply from the thread again and confirm exactly one outbound message appears. Two
   means the echo of our own reply is not being matched on `mid`.

## The messaging window

Meta will not deliver a message sent long after the contact's last one:

| Since their last message | What happens                                                      |
| ------------------------ | ----------------------------------------------------------------- |
| Under 24 hours           | Sent as `messaging_type: RESPONSE`                                |
| 24 hours to 7 days       | Sent as `MESSAGE_TAG` with the `HUMAN_AGENT` tag                  |
| Over 7 days              | Composer blocks the Reply tab and offers an internal note instead |

The middle row needs the Human Agent permission. Without it Meta answers with error code `10`,
which surfaces in the composer as a sentence about the app lacking the permission to send.

This is also why a thread can look answerable and refuse: the block is computed from the newest
_inbound_ message, so a reply of ours does not reopen the window.

## Rollback

Toggle both channels off in Staff → Settings → Inbox Channels. Inbound stops being filed
immediately and the composer stops offering a reply. Nothing bounces; Meta keeps delivering
webhooks and the route keeps answering `200`.

To stop the deliveries as well, unsubscribe the app from the Page:

```bash
curl -X DELETE "https://graph.facebook.com/v21.0/<page-id>/subscribed_apps?access_token=<page-access-token>"
```

Leave the secrets in place — they are inert with the channels off, and removing them buys nothing
but a harder re-enablement.

## Troubleshooting

Read this by symptom.

| Symptom                                                   | Cause                                                                                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook verification fails with `403`                     | `META_VERIFY_TOKEN` is unset on the Worker, or differs from what the app sends. Both read as the same `403` — an unset token never matches, deliberately, so an unconfigured Worker cannot be talked into a handshake.            |
| Meta reports repeated `403`s on delivery                  | `META_APP_SECRET` is wrong. The signature is verified over the raw body, so anything that rewrites the payload in transit breaks it too.                                                                                          |
| Messenger works, Instagram silently does not              | The Instagram account is on Instagram Login rather than linked to the Page under Facebook Login for Business. `me/messages` on `graph.facebook.com` cannot reach it, and there is no error — see [prerequisites](#prerequisites). |
| Threads are titled with a long number                     | The profile lookup returned nothing. It is non-fatal by design, so the message still files. Check `pages_read_engagement`; the lookup also 400s for a contact who has never messaged the Page.                                    |
| A story reply or photo produced no thread                 | Only true before this integration was rewritten. Now they file with a placeholder body — if one is genuinely missing, check whether the channel toggle was off when it arrived.                                                   |
| Our own replies appear in the thread **twice**            | The echo of a dispatched reply is not matching on `mid`. `findMessageByChannelId` is the guard; a null `channelMessageId` on the outbound row (i.e. the Graph response had no `message_id`) defeats it.                           |
| A reply we sent appears as an **inbound** message         | `is_echo` is not being read. This inverts the thread's whole state: it clears `awaitingReplySince` and re-queues a conversation that was just answered.                                                                           |
| A reply is refused with "the messaging window has closed" | Over 7 days since the contact wrote. Nothing to fix — answer in the Meta app, or wait for them to write again. The composer normally blocks this before a send is attempted.                                                      |
| A reply is refused, mentioning a missing permission       | Error code `10` without the window subcode: the app does not hold Human Agent, so it cannot send between 24 hours and 7 days.                                                                                                     |
| Replies stop working with no other change                 | The Page token expired or was revoked — error code `190`. Press **Test connection** in Staff → Settings → Inbox Channels; it names this outright.                                                                                 |
| Meta logs a successful delivery but nothing appears       | The route swallows handler errors and answers `200` unconditionally, because Meta retries for 36 hours and unsubscribes an app that keeps failing. Sentry is the only signal — the `200` proves delivery, not success.            |
| Instagram comments do not appear in the inbox             | By design. They arrive on `entry[].changes[]` and are not read; a comment is a public post, not a conversation.                                                                                                                   |
