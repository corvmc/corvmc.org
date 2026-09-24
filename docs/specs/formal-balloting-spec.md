# Formal balloting

Tracking issue: #577. Governance rulings: #1451 (who votes) and #1452 (secrecy), both decided by the
owner for the board on 2026-09-24. The earlier hold is recorded on #1453.

## Purpose

The suggestion board (`docs/specs/shipped/member-suggestions-spec.md`) counts upvotes, and anyone
can see who gave them. A **ballot** differs from the board in three ways, each of which the board
cannot provide:

- **eligibility**: only a defined electorate may vote;
- **secrecy**: on a member-wide vote, what someone chose must not be readable;
- **a close date**: after it passes, the result is fixed and then certified.

## The two kinds

| Kind     | Electorate                                            | Vote is…                   | Change vote before close |
| -------- | ----------------------------------------------------- | -------------------------- | ------------------------ |
| `group`  | the committee's **active roster**, frozen at open     | **recorded**, like minutes | yes                      |
| `member` | **members of record**, frozen at open, plus overrides | **secret but auditable**   | no                       |

The board of directors is a `committee`-kind `group` like any other committee. A group ballot is
refused on a band or a club, since neither is a governing body.

### Member of record

An account is a member of record on the day a ballot opens when all of these hold:

1. it is active: `user.deleted_at` is null (this covers deactivated accounts) and `user.banned_at`
   is null;
2. it was created at least **N days** before the ballot opens. N is the site-config key
   `ballot.memberOfRecordDays`, with a default of 60. Membership is free, so the account's
   `created_at` is the date membership began;
3. its orientation is **completed or waived** (`member_orientation.completed_at` or `waived_at` is
   set). A waiver is a staff statement that the member does not need showing around, so it counts
   as completing orientation.

**Staff overrides** go either way. **Include** adds someone the rule leaves out; **exclude** removes
someone the rule lets in. Each override needs a written reason and is recorded with
`recordAuditEntry` (`ballot.elector_overridden`, with the member as subject). Overrides can be made
on a draft, where they apply when the ballot opens, or on an open ballot, where they change the
frozen roll at once. **An open ballot refuses an exclude for anyone who has already voted.** A
secret vote cannot be withdrawn: there is no link from the voter to the choice to remove.

Overrides exist only on member-wide ballots. A group ballot's electorate is the roster, and the
roster is changed through the roster.

**No proxies.** Only the elector's own session can cast their vote.

### Frozen at open

A ballot is created as a **draft**. Its question, options, close date and certifier can all be edited
while it is a draft. Pressing **Open** does three things in one `db.batch`:

- sets `opened_at`;
- writes the roll to `ballot_elector` with a single `INSERT … SELECT`, so the electorate is never
  held in memory or bound as parameters;
- for a member-wide ballot, writes one `ballot_choice` counter row per option, each starting at 0.

After that, joining a committee, reaching 60 days or finishing orientation changes nothing about
this ballot. The roll size is stored on `ballot.electorate_size` at open, so the certified turnout
is still meaningful after an elector's account is purged.

## Secrecy

### Recorded (group ballots)

`ballot_recorded_vote (ballot_id, user_id, option_id, updated_at)`, one row per elector, upserted.
A voter can change their vote until `closes_at`. After close, the roll call is shown beside the
tally, like minutes. Before close, each voter sees only their own row.

### Secret but auditable (member-wide ballots)

Two tables. **No column in either names the other, and neither table has a column that can be joined
to the other:**

- `ballot_participation (ballot_id, user_id)`, unique on the pair. This records that the member
  voted, and it is what refuses a second vote. It has no option, no choice id and no timestamp.
- `ballot_choice (ballot_id, option_id, votes)`: **a counter, not a row per vote.**

Casting a vote is one `db.batch`: insert the participation row, then
`UPDATE ballot_choice SET votes = votes + 1`. If the participation insert breaks the unique
constraint, the whole batch rolls back, so the counter never moves without a participation row.

**Why a counter and not one row per vote.** A row per vote with no user id and no timestamp still
leaks the order in which votes were cast. SQLite gives every ordinary table an implicit `rowid` that
grows with each insert, and `ballot_participation` has one too. Ordering both tables by `rowid` and
pairing them up recovers who voted which way. A random UUID primary key does not help, because the
`rowid` is still there underneath it. A counter row is created at open, before anyone votes, and is
only ever updated in place, so it has no insertion order to reveal. Rounding or batching timestamps
does not remove this leak; removing the per-vote row does.

**Auditable** means that after close, anyone who can see the result can check that the sum of the
counters equals the participation count, and staff can see who voted but not what they chose. The
certified result stores `turnout`, `electorateSize` and the per-option counts together.

### The limits, stated

This is secret from the application, from its UI and from anyone reading a table. It is **not**
cryptographically secret, and three things can still break it:

1. **Point-in-time database history.** D1 Time Travel can restore the database as it was at any
   minute in the last 30 days. Someone with Cloudflare account access could compare restores taken
   between two votes: one new participation row, and one counter that went up by one. Against a
   small electorate or a slow ballot, that identifies votes. The only defence is who holds account
   access.
2. **Code or log access.** Whoever can deploy the Worker can log a vote as it is cast. The cast path
   must never log its payload. `castSecretVote` passes the option id to nothing except the counter
   update, and it does not appear in errors, Sentry context or the audit log.
3. **Small or unanimous results.** If all 5 electors voted and all 5 counted "yes", everyone's vote
   is known. That comes with publishing any tally and is not a storage problem.

An election that needs protection against the first two should use a managed election service
(#1452 reading 3). It is not something to build here.

## Tallies and the close

- **Tallies are hidden until `closes_at`, from everyone, staff included.** Tally reads check the
  clock on the server. They do not rely on the UI hiding a number it already received.
- Turnout (`N of M electors have voted`) is visible to the ballot's managers while the ballot is open.
  It says nothing about direction.
- `closes_at` is a stored instant. Closing is derived and needs no cron: a ballot is closed once
  `now >= closes_at`. Every write checks the clock.
- A ballot can be **cancelled** while it is a draft or open. Cancelling takes a reason and is final.
  The result of a cancelled ballot is never shown.

## Certification

Every ballot names a **certifier**, a specific account, when it is created. The certifier can be
changed until the result is certified. After close, only the named certifier can certify, and they
do not have to be an elector. Certifying:

1. snapshots the result into `ballot.certified_result` (JSON: per-option counts, turnout, electorate
   size). The result stays fixed even if an account is later purged and cascades its rows away;
2. stamps `certified_at` and `certified_by_id`;
3. emits `ballot.certified`. A listener writes an in-app notification (`ballot_result`) to **every
   active account**, batched the way `announcement-fanout.ts` batches, and latched on
   `ballot.result_published_at` so an at-least-once redelivery does not notify twice.

A certified result is readable by every signed-in member at `/member/ballots/[id]`. For a recorded
ballot, that includes the roll call.

Opening a ballot also notifies its electors in-app (`ballot_opened`), with the same fan-out.

## Who can do what

| Act                                               | Who                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Create, edit, open or cancel a member-wide ballot | holder of `ballot.manage`                                                             |
| Create, edit, open or cancel a group ballot       | owner or admin of that committee (`requireGroupRole(…, 'admin')`), or `ballot.manage` |
| Override the member-wide electorate               | `ballot.manage`                                                                       |
| See turnout while open                            | the ballot's managers                                                                 |
| Vote                                              | an elector on the frozen roll, in their own session                                   |
| Certify                                           | the named certifier only                                                              |
| Read a closed result                              | electors and managers; after certification, every member                              |

`ballot.manage` is a new capability. Which positions hold it is a gut call, filed as its own
decision issue: `admin` and `staff` hold it, and no named position does. The committee
capability-grant system (#1625) was not on `main` when this was built, so group ballots use
`requireGroupRole` directly. Once #1625 lands, `ballot.manage` could become a grantable capability for
a governance committee.

## Schema

```
ballot                  id, kind, group_id?, title, description?, closes_at, certifier_id,
                        created_by_id, opened_at?, electorate_size?, cancelled_at?,
                        cancel_reason?, certified_at?, certified_by_id?, certified_result?,
                        result_published_at?, created_at, updated_at
ballot_option           id, ballot_id, label, position
ballot_elector          ballot_id, user_id                      unique(ballot_id, user_id)
ballot_elector_override ballot_id, user_id, include, reason, created_by_id, created_at
                                                                unique(ballot_id, user_id)
ballot_participation    ballot_id, user_id                      unique(ballot_id, user_id)
ballot_choice           ballot_id, option_id, votes             unique(ballot_id, option_id)
ballot_recorded_vote    ballot_id, user_id, option_id, updated_at  unique(ballot_id, user_id)
```

Checks: `kind = 'group'` if and only if `group_id` is set; `(cancelled_at is null) = (cancel_reason
is null)`; `votes >= 0`.

`ballot_choice` and `ballot_participation` carry no `created_at` or `updated_at`. **This is
deliberate.** `ballot-secrecy.spec.ts` fails if either table gains a timestamp column, if
`ballot_choice` gains any column that references `user`, or if `ballot_participation` gains any
column that references `ballot_option` or `ballot_choice`.

A ballot has between 2 and 10 options, and each option label is at most 200 characters.

## Surfaces

- `/member/ballots`: ballots you can vote on now, then closed results you can read.
- `/member/ballots/[id]`: the question, the vote form (or your recorded vote and a change control),
  the result after close, and the Certify action for the certifier. For managers, the same page also
  has draft editing, Open, Cancel and turnout.
- `/staff/ballots`: every ballot, plus Create (member-wide or group).
  `/staff/ballots/[id]`: management plus the electorate override card.
- Committee admins create a group ballot from `/member/ballots` ("New ballot", limited to committees
  where they are an owner or admin).

## Out of scope

- **Ranked choice, multi-select and write-ins.** A ballot is one question with one choice.
- **Scheduled opening.** A ballot opens when someone presses Open.
- **Quorum rules.** The certifier reads the turnout and certifies or does not; the bylaws decide what
  counts.
- **Email fan-out of results.** Results are sent in-app and published on the page. Emailing every
  member belongs on the broadcast stream (`marketing`), not the transactional one.
- **Cryptographic secrecy.** See the limits above.

## Phases

1. This spec.
2. Schema, migration, services with specs (including `ballot-secrecy.spec.ts`), and the seed: one
   ballot of each kind.
3. Remote functions, member and staff surfaces, and notifications.
4. Documentation: a business-workflows section, a help article, a feature-catalog row, and moving this
   spec to `shipped/`. Then the landing PR into `main`.
