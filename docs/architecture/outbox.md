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
  A group announcement writes one per recipient, under `group_announcement`, in the same
  batch as its recipient count. A ballot notice writes one per recipient through
  `queueEmails`, under `ballot_opened` or `ballot_result` and the ballot's id.
- **`html_email`**: an email rendered here rather than from a template (recipient, subject,
  HTML, tag), sent on the transactional stream. A campaign's test copy is one (#2771).
- **`inbox_reply`**: an outbound message on an inbox thread. The `inbox_message` row is filed
  with the save; the outbox dispatches it on the thread's channel and stamps the channel's id
  on it. Every reply typed here takes this path (`addOutboundMessage`: staff inbox, band
  enquiries, a staff reply sent by email) and is sent at once, so the author sees the result.
  A reply that has not gone shows as not sent on the thread, with the error, and
  `retryReply` sends it again. `reply-delivery.ts` is the only caller of `dispatchReply`.
- **`campaign_email`**: one recipient's copy of a campaign, named by its `campaign_send` id
  and filed under it. `campaign-delivery.ts` renders it when it is sent and sends it on the
  broadcast stream through Postmark's batch endpoint, which the log driver also answers.
  `executeSend` claims the campaign, then writes each recipient's `campaign_send` row and
  outbox row in the same batch, 250 recipients to a batch. The first 500 go at once
  (`deliverDueSoon`); the cron sends the rest, 200 a run, so no one invocation renders or
  sends a whole audience. The `campaign_send` row stays `pending`, and the campaign page reads
  its outbox row for sent or failed and the error; Postmark's events move it on from there,
  matched by the `campaignSendId` in the message's metadata. An address suppressed while its
  copy waits is not sent to.

`subject_type` and `subject_id` name the record a message belongs to (`market_vendor`,
`directory_entry_link`, `inbox_message`, `campaign_send`), so that record's page can read the newest row with
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

## Senders

`scripts/mail-outbox-guard.spec.ts` refuses a direct import of the Postmark SDK, of any send
function from the client, or of `dispatchReply`, outside the client, the outbox and its
transports (`channel-dispatcher.ts`, `reply-delivery.ts`, `campaign-delivery.ts`). Its list of
senders not yet on the outbox has been empty since #2971; adding to it needs a reason in
review.
