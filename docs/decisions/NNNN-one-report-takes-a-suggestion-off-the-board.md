# NNNN One report takes a suggestion off the board

- **Date:** 2026-08-16
- **Status:** Accepted

## Context

The member suggestion board (#212) publishes a post as soon as it is written, and staff moderate
afterwards. Community event reports move nothing until staff act, because anyone can file one
anonymously. A suggestion report is different: only a signed-in member can file it, and it names
them. The board is small enough that abuse left up until staff look is the larger harm.

## Decision

A single pending report pulls a suggestion off the board straight away. Dismissing the report
puts it back.

1. `createFlag` sets the suggestion's `visibility` to `under_review`. `resolveFlag` hides it on
   uphold and restores it on dismissal, in one place in `flag-service.ts`.
2. The threshold is `SUGGESTION_FLAGS_TO_WITHHOLD`, counted as distinct pending reporters.
3. The controls against misuse: reports are never anonymous, one pending report per suggestion,
   `flagSuggestion` is rate-limited per member, and the staff nav badge counts withheld posts.
4. `visibility` is a separate field from `status`. A public "Declined" and a takedown are
   different states, and the board filter is `visibility = 'visible'` alone.

## Alternatives rejected

- **The event rule: a report moves nothing until staff act.** Abuse would stay up on a small
  board.
- **Dismissal that leaves the post down.** Every member would hold a permanent takedown button.
- **One field for status and visibility.** A member could not tell a decision from a
  disappearance.

## Consequences

- Any member can hide any post until staff look, so the withheld queue is time-sensitive.
- Raising the threshold is a one-line change if the board is ever abused.
- The author is notified (`suggestion_moderated`) when a post comes down, so it does not read as
  a silent removal.
