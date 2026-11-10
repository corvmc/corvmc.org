# Writing interface text

A pass/fail rubric for titles, labels and body text. A string passes only if it clears every check
that applies to it. A failure names the fix. Read alongside [ui-patterns.md](ui-patterns.md).

The voice is plain, not warm. A title or label is often read alone — in a notification, a browser
tab, a list, or by a screen reader — so it has to say what the thing is without the page around it.
Explanation, reassurance and invitation belong in body text, and only when a person cannot act
correctly without them.

Everything is **sentence case**: "Upcoming shifts", not "Upcoming Shifts". Proper nouns keep their
capitals.

## Titles

Page, section, card, modal and empty-state titles.

| #   | Check                                                                                                                                                 | Fails                                    | Passes                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------ |
| T1  | **Out of context.** Read alone, it says what this is.                                                                                                 | "Needs you" (a member's unpaid bookings) | "Unpaid reservations"    |
| T2  | **Meaning first.** The first one or two words carry the information.                                                                                  | "Here are your upcoming shifts"          | "Upcoming shifts"        |
| T3  | **Names the subject.** Section and card titles are adjective + noun naming the rows; page titles name the object; modal titles are verb + object.     | "Lapses before a shift they're on"       | "Expiring clearances"    |
| T4  | **No filler.** No "yet", "just", "now", "here", "please" or exclamation marks; "your" only where it separates mine from everyone's.                   | "No enquiries yet"                       | "No enquiries"           |
| T5  | **Not a sentence.** No end period, no clause. A question only as a yes/no confirmation modal.                                                         | "No one has signed up to volunteer yet." | "No volunteers"          |
| T6  | **Length.** Aim for 2–3 words. 4–6 only when nothing shorter names the subject. Never more than 6. A placeholder such as `{name}` counts as one word. | "Waiting for the card form to load"      | "Loading card form"      |
| T7  | **No pronoun pointing outside the title.** "This", "these", "they", "it" only with their noun after them.                                             | "Approve these?"                         | "Approve hours?"         |
| T8  | **Judges no one.** States what is true of the thing, not who failed to act.                                                                           | "Nobody confirmed"                       | "Unconfirmed volunteers" |
| T9  | **Same word for the same thing.** Use the app's existing term for an object or action, not a near-synonym.                                            | "Gig details" on an event page           | "Event details"          |

## Labels

Buttons, actions and form fields. T1, T4, T7 and T9 apply, plus:

| #   | Check                                                                                      | Fails                                                              | Passes                     |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------- |
| L1  | **A button is a verb, or verb + object.** Never "someone", "something", or a question.     | "Log hours for someone"; "Can't make it?"                          | "Log hours"; "Cancel RSVP" |
| L2  | **A field label is a noun.** Instructions go in help text.                                 | "Enter the guarantee amount"                                       | "Guarantee"                |
| L3  | **A checkbox states what happens,** in at most 8 words. The explanation goes in help text. | "Comes off the door before a percentage-of-net deal is worked out" | "Deduct before net split"  |

## Body text and subtitles

| #   | Check                                                                                                     | Fails                                                            | Passes                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| B1  | **One sentence, and only when needed to act.** Empty-state explanations and invitations are allowed here. | Title: "Be the first to say what the collective should do next." | Title "No suggestions"; body "Be the first to say what the collective should do next." |

## Applying it

- **Mechanical checks** — T4, T5, T6 and the bare-pronoun half of T7 — can be enforced by lint over
  the message catalog. L1's "someone/something" half already is: `custom/definite-action-labels`.
- **Judgement checks** — T1, T2, T3, T8, T9 — are for review. When writing or reviewing a page,
  score each new or changed title and label against the table and fix every failure before
  shipping. A 4–6 word title needs a reason in the PR.

Sources: [GOV.UK, writing for user interfaces](https://www.gov.uk/service-manual/design/writing-for-user-interfaces);
[NN/g, microcontent](https://www.nngroup.com/articles/microcontent-how-to-write-headlines-page-titles-and-subject-lines/);
[NN/g, layer-cake scanning](https://www.nngroup.com/articles/layer-cake-pattern-scanning/).
