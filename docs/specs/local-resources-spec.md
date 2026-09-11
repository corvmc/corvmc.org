# Local resources

> **Status: 📋 designed, not built.** Tracking issue: #575.
>
> A public, staff-curated list of music-related businesses and services around Corvallis —
> instrument shops, venues, record stores, rehearsal studios, repair techs. It positions the
> collective as a hub and cross-promotes the ecosystem it sits in.

## What exists today

`/local-resources` is live and lists nothing. It is a hero, four decorative category tiles built
from a hardcoded array, and a Turnstile-guarded contact form that files a free-text message into the
staff inbox. Its only `<h2>` is "Suggest a Resource".

That is the collection form for a directory that was never built, which is a reasonable first move
and is why #575 was closed as shipped in error — the route existed, the feature did not. There is no
`local_resource` table, no query, and no staff surface.

**The page keeps its job and gains the list above it.** Nothing here throws away what is there.

## A local resource is not a supplier

`inventory-spec.md` deferred a `supplier` table partly on the grounds that "the same _local
business_ entity is wanted by the Local Resources Directory and Affiliate Commissions entries."
**That reasoning does not hold and this spec does not inherit it.**

A supplier is who the collective buys from: internal, operational, and mostly not a music business
at all — a hardware store, a janitorial service, an online retailer. It exists to answer "what did
we spend at X." A local resource is who the collective points the community at: public, curated, and
music-specific. Most local resources have never sold CMC anything.

The overlap is a gear shop that is both, which is incidental rather than definitional. One table for
both would put `visibility` and a public description on a spend rollup, and invoice-adjacent data on
a public listing. **Two entities.** If the shop is ever both, it is two rows, and that is correct.

The rest of `inventory-spec.md`'s argument for deferring `supplier` stands on its own and is
untouched: the collective buys from a handful of shops, so free text plus a `GROUP BY` answers the
question. #605 is not blocked by this spec.

## Its own table, not `directory_entry`

`directory_entry` can already hold a row with `userId` and `groupId` both null, which makes it
technically capable of this. It should not be used.

- **It is shaped for acts and people.** `foundedYear`, `availableForHire`, `teachesLessons`,
  `openToCollaboration`, `hometown`, `bio` — a record store answers none of those, and a resource
  wants an address and a category, which an act does not.
- **It is pending a rename**, so adding a third meaning to it now means renaming a
  three-meaning table later.
- **The queries do not overlap.** The directory's list is `ORDER BY name` across members and bands
  with instrument and genre filters. A resource list is grouped by category. Sharing the table means
  every existing directory query grows a `kind` predicate it did not need, and the one that forgets
  leaks a guitar shop into the member directory.

`groups-spec.md` collapsed bands, clubs and committees into one `group` because they are the same
thing doing different jobs. A record store and a band are not.

## Contact information is public here, and must not use `contact`

`contact` (`src/lib/server/db/schema/contact.ts`) is the **private** half of a party record —
an external act's booking details, staff-only, behind `contact-service.ts` and the
`custom/no-contact-schema-imports` lint rule.

A shop's street address, phone and website are the opposite: they are the point of the listing, and
they are already on the shop's own front door. **Local resource contact fields live on the resource
row and are read by a public query.** Do not reach for `contact`, and do not add a resource
reference to it — the lint rule exists precisely so that borrowing it is a decision someone has to
make on purpose.

## Schema

Two tables. Deliberately small: the value is the curated list, not the record depth.

### `local_resource`

| Column                  | Type                                     | Notes                                                            |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `id`                    | text pk                                  | uuid, house pattern                                              |
| `categoryId`            | text → `local_resource_category.id`      | `onDelete: 'restrict'` — see below                               |
| `name`                  | text not null                            |                                                                  |
| `description`           | text                                     | A sentence or two. Not a rich-text field                         |
| `website`               | text                                     |                                                                  |
| `phone`                 | text                                     |                                                                  |
| `addressLine`           | text                                     | One line, freeform — see the open question                       |
| `status`                | text enum, not null, default `'pending'` | `pending` · `published` · `rejected`                             |
| `submittedByUserId`     | text → `user.id`, nullable               | Null for an anonymous tip                                        |
| `submitterEmail`        | text                                     | So a tipper can be told the outcome. Null when staff authored it |
| `staffNote`             | text                                     | Why it was rejected, shown back to the submitter                 |
| `reviewedByUserId`      | text → `user.id`, nullable               |                                                                  |
| `reviewedAt`            | integer timestamp                        |                                                                  |
| `displayOrder`          | integer not null default 0               | Staff pinning within a category                                  |
| `createdAt`/`updatedAt` | integer timestamp                        | House default                                                    |
| `deletedAt`             | integer timestamp, nullable              | Soft delete, as every other listing                              |

Indexes: `(status, categoryId)` for the public list, `status` for the review queue.

**No `slug` and no detail page.** A resource is a name, a line of description and a way to reach
them — it renders as a card in a list, and its own page would be an empty one. Add it when a
resource has something to say that does not fit on the card.

### `local_resource_category`

Follows `equipment_category` exactly, which is the house pattern for a staff-managed vocabulary:

| Column                  | Type                       | Notes |
| ----------------------- | -------------------------- | ----- |
| `id`                    | text pk                    |       |
| `name`                  | text not null unique       |       |
| `displayOrder`          | integer not null default 0 |       |
| `createdAt`/`updatedAt` | integer timestamp          |       |

A table rather than a `config.ts` const because staff add categories, and a const means a deploy.
`suggestionCategories` is a const because its values are load-bearing in code — a `gear_equipment`
suggestion has behaviour attached. These are labels with an order, which is what
`equipment_category` already established as table-shaped.

`restrict` on the resource's foreign key rather than `cascade`: deleting a category that still has
resources in it should fail and say so, not silently take the listings with it.

## The tip flow

The page already asks for tips. Today the answer arrives as prose in the staff inbox — _"Resource
name, a link if you have one, and why it's worth knowing"_ — and a staffer retypes it. That is the
part to replace.

**A tip creates a `local_resource` row at `pending`.** Same Turnstile guard, same anonymous-friendly
form, but structured: name, category, website, phone, address, description, plus the submitter's
email so they can be told what happened.

Staff review from a queue at `/staff/local-resources`:

- **Publish** — `status = 'published'`, visible immediately.
- **Reject** — `status = 'rejected'` with a `staffNote`.

**`rejected` is editable and resubmittable**, not terminal. `moderation-appeals-spec.md` records the
lesson: a hidden suggestion is terminal, so `hidden` does double duty as "this is bad" and "not like
this", and the cheap everyday fix is a return state where staff hand it back with a note. Community
listings got that right and suggestions did not. This starts with it.

A submitter who left an email is told the outcome either way. That is a `local_resource.reviewed`
listener, not a new mail path.

Rate limiting and bot defence are what the Turnstile already on the page does. Note that
**#803 (a failed Turnstile check renders no message)** is the same class of bug on the public event
report and will be the same bug here if the form is copied without reading it.

## Surfaces

| Route                               | Who    | What                                                                                        |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `/local-resources`                  | public | Published resources grouped by category, `displayOrder` then `name`, with the tip form kept |
| `/staff/local-resources`            | staff  | Review queue (pending first) and the published list                                         |
| `/staff/local-resources/categories` | staff  | Category CRUD with `displayOrder`                                                           |

The public page needs **one load-bearing query** returning categories with their published
resources, not one query per category.

Guards: `requireStaff` on every write and on the queue read. The public list is unguarded and must
filter `status = 'published'` and `deletedAt is null` in the query rather than in the component.

## Phases

| #   | What                                                     | Ships when                            |
| --- | -------------------------------------------------------- | ------------------------------------- |
| 1   | Both tables, the service, seed data, staff category CRUD | Staff can define the vocabulary       |
| 2   | `/staff/local-resources` queue; staff-authored resources | Staff can build the list themselves   |
| 3   | The public list on `/local-resources`, replacing nothing | The page stops being an empty promise |
| 4   | The structured tip form and the outcome notification     | The public can contribute             |

Phase 1 seeds real categories and a handful of genuine Corvallis resources into
`scripts/seed-dev.ts`, so phases 2–4 are built against a populated table rather than an empty one.

## Open questions

1. **Address as one line, or structured?** One line is right for rendering and wrong for a map. No
   map is planned, so this spec says one line — revisit only if a map is.
2. **Does a resource ever have an owner?** A shop asking to correct its own listing is a real
   request and has no answer here. The claim-your-listing shape exists in `/act/{token}` for external
   acts; borrowing it is a phase 5, not a column now.
3. **Overlap with the member directory.** A freelance sound engineer could be a member profile, an
   instructor listing, or a local resource. The rule this spec assumes is **a business is a
   resource, a person is a profile** — a sole trader is whichever they present as. Not settled.

## Not in this spec

- **#584 Affiliate Commissions** attaches to this entity and is a separate feature. Nothing here
  models a referral, a click-through or a commission agreement.
- **Suppliers and `acquisition.sourceName`** — see above; a different entity, unblocked, #605.
- **#601's service-to-other-businesses clause.** ASCAP/BMI reporting offered as a service to local
  businesses is not a directory feature; that clause should be dropped from #601 or split out.
- **A detail page per resource**, until a resource has more to say than a card holds.
