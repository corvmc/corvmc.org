# NNNN Suggestion edits lock at the first outside vote

- **Date:** 2026-08-16
- **Status:** Accepted

## Context

Authors of suggestions on the member board (#212) need to fix typos. An open edit allows a
bait-and-switch: post something agreeable, collect votes, then swap the text and keep the
endorsement.

## Decision

The trigger is votes, not time. An author edits freely until another member votes. After that, an
edit files a `suggestion_edit` request that staff approve or reject.

1. The count excludes the author's own vote, so upvoting your own post does not lock it.
2. `getEditableState` decides for the caller whether an edit applies directly, and the button
   reads **Edit** or **Request an edit** to match.
3. The request stores a snapshot of the text it replaces, so staff review the change the author
   saw.
4. Approving writes the new text first and marks the request second, and never touches votes.
5. A hidden or merged suggestion cannot be edited.

## Alternatives rejected

- **Every edit goes to staff.** It adds staff work in the common case of a typo fixed in the
  first minutes.
- **Edits go through but reset the vote count.** Fixing a typo would cost a popular suggestion
  its votes, so nobody would fix one.

## Consequences

- Staff see edit requests only for suggestions other members have endorsed.
- `editedAt` is stamped only when the title or body changes.
