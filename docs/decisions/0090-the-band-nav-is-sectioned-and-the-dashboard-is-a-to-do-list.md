# 0090 The band nav is sectioned and the dashboard is a to-do list

- **Date:** 2026-11-16
- **Status:** Accepted
- **Issue:** [#3127](https://github.com/corvmc/corvmc.org/issues/3127), option A: #3128, #3129,
  #3134, #3136, #3138. PRs #3142, #3145, #3149, #3152 and the follow-up phase, landed by #3151.

## Context

The band sidebar was one flat list of up to fourteen rows. The rows for one job, such as the
public profile, sat apart from each other. The staff nav had been grouped by question in
[0088](0088-the-staff-nav-answers-four-questions.md); the band panel had no groups. Messages had
left the sidebar for the topbar icon, whose count spans every inbox the viewer reads, so a band
could not tell from its own nav that an enquiry was waiting. The dashboard led with the address,
the press kit bar and two counts, and did not show what the band owed or had to answer.

## Decision

1. **The band nav has sections, each one question.** Dashboard on top; Schedule (Reservations,
   Events), Band (Members, Announcements, Messages), Profile (Band profile, Press kit, Page
   editor), Stage (Tech rider, Packing list) and Music (Releases, Payouts) when `bandAudio` is on;
   Subscription and Settings at the foot. URLs and role gating do not change. A section the viewer
   can see no row of is dropped.
2. **Messages is a sidebar row**, covering chat and enquiries on one page. Its badge counts this
   band's open, unread chat threads and, for owners and admins, its open, unread enquiries. The
   topbar icon stays.
3. **Every active member reads the profile and press kit**; only owners and admins edit them. The
   read queries take `member`; every write remote and upload route keeps `admin`. The page
   disables the form for anyone else. The address and QR card live on the profile page.
4. **The dashboard is one query and a to-do list.** Pending actions first, then upcoming
   reservations and events together, then a four-step setup checklist, then the press kit
   progress once setup is done.
5. **Setup's invite step is done once an invite is sent**, or once a one-person project dismisses
   it. The dismissal is stored per band, on `group.invite_step_dismissed_at`.
6. **A new band sees every row at full weight.** Rows are not dimmed or hidden by band size.

## Alternatives rejected

- **A separate Enquiries row.** Chat and enquiries share one page; a second row would be a second
  link to it.
- **Dimming or collapsing rows for a band of one.** The owner declined both: the rows a new band
  needs should look the same as the rest.
- **Profile rows for owners and admins only.** A member hands out the band's address and answers
  for its profile, so the read view belongs to every member.

## Consequences

- `band/[slug]/nav-items.spec.ts` places every row in exactly one zone for every role.
- `band-profile-access.spec.ts` holds that a plain member gets the read view and is refused on
  the profile and press kit writes.
- `band-dashboard.remote.spec.ts` holds which dashboard rows each role sees, and the dismissal
  guard.
