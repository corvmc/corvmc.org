# The outbox

A save either succeeds or fails on its own write. The email or message it owes is a row in
`outbox_message`, written in the same `db.batch` as the save, and sent afterwards. A refused
send never turns a saved change into an error, and an action that promises a send reads the
row to say whether it happened (#2839).

## Lifecycle

| State                      | Meaning                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `pending`, no `last_error` | Written, not yet sent                                                         |
| `pending`, `last_error`    | A send failed; the next try is at `next_attempt_at`                           |
| `sent`                     | The provider took it; `provider_message_id` holds Postmark's or the channel's |
| `failed`                   | Five sends failed; nothing retries it                                         |

Retries back off at 1, 4, 16 and 64 minutes. A sender claims a row by setting
`claimed_until` in the same `UPDATE` that checks it is due, so the cron and an eager send
never both send it. A sender that dies mid-send frees the row after five minutes, which makes
delivery at-least-once.

## Kinds

- **`email`**: a Postmark template send (recipient, alias, model, reply-to, tag). Sent in
  batches of 500 with a result per message, so one refused recipient fails only its own row.
- **`html_email`**: an email rendered here rather than from a template (recipient, subject,
  HTML, tag), sent on the transactional stream. A campaign's test copy is one (#2771).
- **`inbox_reply`**: an outbound message on an inbox thread. The `inbox_message` row is filed
  with the save; the outbox dispatches it on the thread's channel and stamps the channel's id
  on it.

`subject_type` and `subject_id` name the record a message belongs to (`market_vendor`,
`directory_entry_link`, `inbox_message`), so that record's page can read the newest row with
`latestDelivery`.

## Writing one

- **With a write of your own:** put `emailRow(...)` (or `queuedReplyStatements(...)`) in the
  same `db.batch` as the write. Then either `deliverSoon([id])`, which sends after the
  response, or `await deliverNow(id)`, when the answer shown to the user depends on it.
- **With nothing to batch with:** `queueEmail` / `queueEmails`. The notification dispatcher
  (`dispatch`, `dispatchBatch`, `dispatchEmailOnly`, `dispatchEmailOnlyBatch`) does this for
  every notification email.

`/api/cron/send-outbox` runs every five minutes and sends whatever is due.

## The mail driver

`MAIL_DRIVER=postmark` is set in `wrangler.toml`, so only production calls Postmark. Anything
else, including unset, uses the log driver: it prints the template, model and recipient and
answers as Postmark would. Local runs and e2e therefore exercise the whole send path without a
token and without reaching a real inbox. See
[local-dev-quickstart.md](../development/local-dev-quickstart.md#7-email-locally).

## Senders not yet on the outbox

`scripts/mail-outbox-guard.spec.ts` lists the modules still allowed to import the Postmark
client directly. The list only shrinks. Each entry is a sender whose failure is still thrown
or lost rather than recorded:

| Module                                         | Sends                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/marketing/campaign-service.ts` | Campaign broadcasts. Each recipient's result, and each audience member skipped as unsubscribed or suppressed, is recorded in `campaign_send` (#2777, #2914); nothing is retried |
| `src/lib/server/group/announcement-fanout.ts`  | Group announcement fan-out                                                                                                                                                      |
| `src/lib/server/ballot/ballot-fanout.ts`       | Ballot fan-out                                                                                                                                                                  |
| `src/lib/server/inbox/channel-dispatcher.ts`   | Inbox replies typed in the staff inbox                                                                                                                                          |
