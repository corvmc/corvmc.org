# 0087 Bands, clubs and committees are listed apart

- **Date:** 2026-11-15
- **Status:** Accepted
- **Issue:** [#3027](https://github.com/corvmc/corvmc.org/issues/3027); amends the Groups list of
  [#2912](https://github.com/corvmc/corvmc.org/pull/2912)

## Context

#2912 put bands, clubs and committees on one staff list, `/staff/groups`, with a kind filter. Each
kind already had its own columns, actions and capability, so the list was three lists behind one
nav row. The nav is grouped into four systems (#2762). A band is something members do together, a
club is a program the Collective runs, and a committee is part of how it runs: decision
[0085](0085-committees-are-departments.md) made committees departments.

## Decision

1. **Each kind has its own staff list, in the section it belongs to.** Bands under Community
   (`/staff/bands`, `band.read`), clubs under Programs (`/staff/clubs`, `group.read`), committees
   under Operations (`/staff/committees`, `committee.manage` or `committee.reviewApplications`).
2. **Each record sits under its kind's list:** `/staff/bands/[id]`, `/staff/clubs/[id]`,
   `/staff/committees/[id]`. A record page given another kind's id sends it to that kind's page.
3. **Committees keep the name "Committees"**, though they work as departments.
4. **A nav row's capabilities are the page's guards.** The committee pages accept either committee
   capability, as their row does.
5. `/staff/groups` and `/staff/groups/[id]` 308 to the kind's address, with `via=groups`, because
   every kind's address once 308'd to `/staff/groups` (#2961).

## Alternatives rejected

- **Keep one Groups list.** It places clubs and committees outside the sections their work belongs
  to, and the kind filter only switches between three pages.
- **Rename committees to departments.** The name is in use with members and on the public site.

## Consequences

- A regrouping of the nav (#2762) keeps these three rows apart.
- Links to a group whose kind is unknown go through `staffGroupHref`, or land on the record page that
  redirects by kind. A group application's ref carries its group's kind.
- Outside acts stay Contacts' performer role; the Bands page links to it.
