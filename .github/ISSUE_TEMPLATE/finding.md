---
name: Finding (found while doing something else)
about: A real problem noticed in passing, filed rather than fixed
labels: needs-triage, agent-filed
---

<!-- This is the template a Claude session uses for something it found but did
     not fix. The bar is the same as a human's: a finding worth filing is one
     someone else could act on without asking you what you meant.

     Do not file a hunch, a style preference, or something you already fixed. -->

## What is wrong

<!-- One or two sentences. Lead with the defect, not the discovery. -->

## Where

<!-- `file.ts:line`. Required — a finding without a location is a feeling. -->

## How it was found

<!-- What the session was actually doing. This is what lets a reader judge how
     much the finding was verified versus inferred from reading. -->

## Why it was not fixed here

<!-- Out of scope for the change in hand, needs a decision, or spans work the
     current PR should not carry. If the honest answer is "it would have been
     quick", fix it instead of filing this. -->

## What the fix looks like

<!-- Or the open question that has to be settled first. -->

## Confidence

<!-- Verified by running it, or inferred from reading the code. Say which. -->
