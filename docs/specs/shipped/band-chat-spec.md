# Band chat — booking enquiries become conversations

A stranger who wants to hire an act writes to it through the form on its public profile. That
enquiry now lands as a thread the band reads and answers on the site, instead of an email nobody
has a record of.

Status: **implemented**.

## Why an owner column rather than a new feature

The form itself is old. `submitBandContactForm` has been the only route to an act since the press
kit went free — no address of any kind is published, so there is nothing on the page for a scraper
to take. What it did with an enquiry was send one email to whichever address the press kit named,
and then forget it.

That left the act with a message in a personal mailbox: unthreaded, with no status, no record that
anyone had answered, and no way to answer that did not put their own address in a stranger's inbox.
`docs/architecture/domain-model.md` had already named this "the clearest remaining case" and
written the fix down:

> One nullable owner column on `inbox_thread` — null meaning CMC, the same shape `directory_entry`
> uses for its two nullable owners — turns one inbox into many.

The transport was already in production three times over. The staff queue, member↔staff portal chat
and member↔member DMs all run on `inbox_thread` / `inbox_message`, separated by `channel`. Band
chat is a fourth channel plus that column — not a parallel system.

## Model

```
inbox_thread.group_id   → group (cascade), NULLABLE — null means CorvMC
inbox_group_read        thread_id → inbox_thread, user_id → user, last_read_at
                        UNIQUE (thread_id, user_id)
```

`channel` gains `band`, and `band` joins `web` and `portal` as an **always-enabled** channel: the
enquiry arrives through the site, and the reply goes out on the transactional stream we already
own. The `email` toggle governs the inbound support mailbox, not our ability to answer.

### Ownership is live, and that is why the cursor moved

`docs/specs/groups-spec.md` left "a group as a messaging recipient" open with one question:

> whether addressing a group **expands to participant rows at send time** (a snapshot — later
> joiners never see the thread, leavers stay in it) or **references the group and resolves
> membership at read time** (live — but the read cursor lives on the participant row, so unread
> would need rethinking).

**Live.** A band's booking history has to follow its roster: a new admin needs the back catalogue,
and someone who leaves must lose it. So ownership is `inbox_thread.group_id`, participation is
`requireGroupRole`, and nothing is snapshotted.

That makes it structural that **a band thread has zero `inbox_participant` rows**, exactly like the
outward channels. This is not tidiness. Every member-side query in `direct-service.ts` and
`portal-service.ts` finds its threads by joining `inbox_participant`; one row there would surface a
booking enquiry in `/member/messages` for every admin who had ever opened it. Leaving the table
untouched is what let this ship without editing a single DM query — and `direct-service.ts` has
already taken a production outage from a filter of exactly that shape.

The unread cursor the participant row would have carried is `inbox_group_read`, written lazily on
first open. Unread means `thread.lastMessageAt` is newer than `last_read_at`, or that there is no
row at all — which a LEFT JOIN answers for free, so an enquiry nobody has opened is unread for the
whole band.

`band-service.spec.ts` pins both halves: the list never touches `inbox_participant`, and
`markBandThreadRead` writes to `inbox_group_read` or, for a thread the band does not own, to
nothing.

## Delivery, both directions

**In.** `submitBandContactForm` keeps Turnstile and the `band-contact:{bandId}:{ip}` rate limit
unchanged, then calls `handleBandEnquiry`, which always opens a **new** thread. The form is
one-shot and carries no thread id, so the only thing it could fold on is the sender's address —
which would let someone append to a negotiation the band had closed, and would merge two unrelated
enquiries from the same booking agent.

**Out.** The band replies on the site; `addOutboundMessage` dispatches it as email through
`dispatchBandReply`. Two things differ from the staff email path:

- **The template.** `inbox-reply` signs off as the Corvallis Music Collective and tells the reader
  they are getting it because they contacted us. Neither is true here, so `band-reply` names the
  act, and the From display name is `"<Band> via CorvMC"`. The address stays ours, because that is
  where SPF and DKIM are.
- **No staff-mailbox fallback.** The email path falls back to `STAFF_CONTACT_EMAIL` when no inbound
  reply address is configured, so a response still reaches a human. Here that human would be staff
  reading a booking negotiation they are not party to, so the reply simply carries no Reply-To.

**Back in.** `buildReplyToAddress` is per-thread and signed, and `handlePostmarkInbound` was already
channel-agnostic after the hash resolves, so the booker's reply routes into the thread with no new
code. **Neither side ever sees the other's address** — the booker never learns the act's, and the
act never needs the booker's. That property is the reason the conversation can live on the site at
all.

### The one thing the relay had to be stopped from doing

`handlePostmarkInbound` relays a _staff_ reply as an **outbound** message, so that a staffer
answering a contact-form alert from their mail client has their words delivered rather than filed
as the contact's. On this channel an outbound message goes out over the band's name — so a staffer
who was forwarded a band's reply and answered it would have been writing to a booker as the act.
Band threads skip the relay and record the words as inbound instead.

## Staff cannot see any of it

`staffVisibleThread` excludes `band` alongside `direct`, and `getThread()` refuses both before it
fetches a message or a note. Same terms as a DM: a pending `content_flag` on the thread brings it
into the queue, and nothing else does. `content_flag.entityType` already carries `'inbox_thread'`,
so reporting one needed no schema.

`band` is also absent from `getAllChannelConfigs`, so it appears neither in Staff Settings → Inbox
Channels nor in the queue's channel filter. It is always enabled and there is nothing to
configure; the filter option could only ever produce an empty list.

## Who may read and answer

Owner and admin. Answering an enquiry commits the act to a date and a price, which is the line
Press Kit and Edit Profile already draw; the tech rider is the deliberate exception on the other
side of it. A staff non-member is excluded too — they are not the act.

The list queries resolve the band from its slug. **The mutations resolve it from the thread**, via
`bandOfThread`. A slug and a thread id arriving together are two claims nothing makes agree: a
caller could name their own band and someone else's thread, passing the guard on the first while
the service was handed the second. One key, derived from the row being written, cannot disagree
with itself.

## Notifications

`inbox.message_received` already fires for both ways a message arrives — the form and the booker's
reply routed back in — so one branch on that event covers both. It notifies the band's owner and
admins (in-app plus email, per their own preferences) with a link to the thread; the same handler
early-returns for `direct` and now for `band` before the staff fan-out, because that event carries
a 200-character preview and every band's booking enquiry would otherwise open in every staffer's
notification bell.

`band_enquiry_received` is a registered notification type, so it has a preference toggle.
`band_site_contact` never was — `dispatchEmailOnly` skips the registry — which is part of what
made the old behaviour unswitchable.

### The off-platform booking contact

One case the thread does not cover. `epk.bookingContact.email` is often a manager or an agent with
no CorvMC account, and notifying only the roster would have cut them off silently. So the old
`band_site_contact` email survives, unchanged and with the sender's own address as its Reply-To, in
exactly one branch: a booking address that matches **no active owner or admin**. An address that
does belong to someone on the roster gets nothing extra — they are already being notified, and
sending both would deliver every enquiry twice.

The owner is no longer a fallback recipient. They are on the roster, so they are notified.

## Surfaces

| Path                         | What                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/directory/bands/[slug]`    | The public form, unchanged. Still the only route to an act, still publishing no address.                          |
| `/band/[slug]/messages`      | The band's enquiries, in the left pane of a two-pane inbox. Unread dot, "Waiting on them", "Closed". Owner/admin. |
| `/band/[slug]/messages/[id]` | One enquiry: timeline, reply box, and Close / Reopen. Opening it marks it read for that reader only.              |
| Band nav                     | A Messages row with an unread badge, above Members — the only row that can be waiting on somebody. Owner/admin.   |
| `/staff/inbox`               | **Nothing.** Band threads are absent from every view, filter and search until one is reported.                    |

Both panes are the shared `InboxShell`, mounted from `+layout.svelte` so the list survives
navigating between threads.

### Timeline orientation

`ThreadTimeline` is used in **direction mode** — no `viewerUserId` — which is the _staff_ inbox's
mode, not the member inbox's. The band is an organisation here: a bandmate's reply has to read as
the band's side of the conversation, and passing the viewer would put it on the left, beside the
booker's own messages. Who wrote it comes from `authorName`, which `addOutboundMessage` already
stores. No author user id is sent to the client at all.

## Deliberately not built

- **Snooze, assignment, internal notes and tags.** A four-person act is not a work queue.
- **Resolve as a dead end.** Unlike the portal, closing an enquiry is reversible — the band reopens
  it, and a booker writing back reopens it too. An irreversible archive would only teach an act not
  to use the button.
- **Threads for anything but the booking form.** `group_id` is general and clubs and committees
  could own threads tomorrow; nothing writes one today.
- **Live push.** Same as the portal: the SSE registry is per-isolate on Workers, and the
  notification bell covers a reply arriving while the page is open.

## Reserved-word migrations

Adding this column found a drizzle-kit bug worth knowing about. `ALTER TABLE ... ADD ... REFERENCES
group(id)` is emitted **unquoted**, and `group` is a SQLite keyword, so the migration was a syntax
error that would have failed on first apply. Every earlier `ALTER ... ADD ... REFERENCES` in this
repo happens to name a non-reserved table, which is why nothing had hit it.

Fixed at the generator rather than by hand: `scripts/db/quote-reserved-refs.mjs`, wired into
`pnpm db:generate` (`--write`) and `pnpm db:check-migrations` (`--check`, which CI already runs).
The equivalent `CREATE TABLE` form was always correct — drizzle renders those as a named
`CONSTRAINT` with the table backticked — so only the ALTER path is affected.
