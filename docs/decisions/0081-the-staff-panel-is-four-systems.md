# 0081 The staff panel is four systems

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2763](https://github.com/corvmc/corvmc.org/issues/2763), parent
  [#2762](https://github.com/corvmc/corvmc.org/issues/2762)

## Context

The staff sidebar had grown nine sections (People, Planning, Space, Partners, Moderation, Outreach,
Money, Reports, System), several holding one row. Settings held module settings beside
organization-wide ones: inbox channels, the volunteer hour value and the Stripe subscription sync.
[0059](0059-the-practice-space-page-runs-the-space.md) had already moved the practice space's
settings to its own page.

## Decision

1. **Four systems.** The sidebar's sections are Relationships (Contacts, Outreach, Funding),
   Community (Members, Groups, Suggestions, Moderation, content), Programs (Events, Practice space,
   Music) and Operations (Tasks, Volunteering, Equipment, Supplies, Money). Dashboard and Inbox sit
   above them; Reports and System below. A new module joins one of the four.
2. **Row keys do not change.** Starred rows store them, so a renamed or moved row keeps its key:
   Equipment is `gear`, Money is `payments`, System is `settings`.
3. **System is its own panel.** `/staff/system` swaps the sidebar for Organization, Features,
   Access and Audit log, each with its own URL and capability, and a link back. It holds only
   what spans modules.
4. **A module's settings live on the module.** Inbox channels are Inbox's Channels view.
   Volunteering has a Settings page with the hour value and the orientation shift, both
   `volunteer.*` settings. The Stripe sync and the community stats refresh are actions on the
   Members list. This moves orientation out of the Practice space settings page that 0059 put it
   on.
5. **Old URLs redirect.** `/staff/settings?tab=…`, `/staff/audit` and `/staff/access` land where
   each moved.

## Alternatives rejected

- **Keep Settings as a tab bar.** A tab bar cannot hold Access and the audit log's tables at the
  width they need, and it kept module settings where the module's staff do not look.
- **Orientation stays on Practice space.** It is configured as a volunteer role and shift, and
  the hour value it sits beside is a volunteer setting.

## Consequences

- `nav-items.spec.ts` pins the four sections, their rows and the System rows' capabilities;
  `system-redirects.spec.ts` pins each old URL.
- Every capability that opens a System row also shows the System row in the staff sidebar.
- The capabilities did not change: module settings still read with `settings.read` and write with
  `settings.update`, Channels with `inbox.read` and `inbox.manageChannels`.
