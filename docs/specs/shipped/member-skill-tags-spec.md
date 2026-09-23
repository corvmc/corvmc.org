# Member skill tags

Tracking: #582.

## What gets built

A member can list what they can do **besides play**, such as sound engineer, photographer,
promoter or graphic design. Other members and staff can then find them for it.

- **One more `directory_tag` kind, `skill`.** It is free text with suggestions, like instruments,
  lower-cased and capped at 20 per member by the same `validateTags`. A drizzle text enum emits no
  SQL, so it needs no migration.
- **Members only.** A band's needs are already `seeking_instrument`. A band that needs a sound
  engineer is asking a person, and the person carries the tag.
- **Written on `/member/profile`** in the Music card, under instruments and genres.
- **Read in three places**: a Skills tag cloud on both member profile pages (members-only and
  public), and a Skills filter on the Members tab of `/member/directory`. The filter uses the same
  `tagCondition`, so it is scoped to `kind = 'skill'` and a genre with the same spelling cannot
  answer it.
- **Public like instruments.** `toPublicMemberProfile` carries `skills`. A member whose listing is
  public is advertising, and "available for hire" is already public next to it.

## Not in this slice

- **Feeding the volunteer shortlist.** A shift's "who to ask" shortlist could rank members whose
  skills match the role. That is filed on its own. `volunteer_role` names are staff-defined and
  skill tags are member-typed free text, so the join needs a mapping someone owns, not a string
  compare.
- **A curated vocabulary.** Suggestions come from what members have already typed, as with
  instruments. A staff-kept list waits until drift shows up in the data.
- **Showing skills on the directory card.** The `IdCard` already carries instruments, genres and
  four flags, so a skill on the card would crowd out the instruments it is meant to sit beside.

## Seed

`users.ts` gives every third bulk member with a profile one skill from `SKILLS` in `pools.ts`. It
picks by index rather than by `random()`, so the pinned sequence does not shift. The `undecided@`
persona carries `sound engineer` and `photographer`, so the skill filter finds someone who matches
on nothing else.
