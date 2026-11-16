# Directory profile pages

Status: ✅ Unified component set

Member & band, public & authenticated profiles all compose one set of 9 parameterised components (`src/lib/components/directory/profile/`): ProfileHeader, QuickFacts, ProseBlock, ListenStrip (switchable embed), ShowsBox (band own + member aggregated-across-bands; both tabs render the public gig guide's `GigList` rows, with past shows paged 20 at a time), CrossRefList (bands↔members, locked private rows in public), TagCloud, LinksBox (streaming ribbon + web rows), ContactBox. Avatar convention: member = round, band = square (`EntityAvatar`). Adds `user.memberNumber`/`hometown`, `band.hometown`/`foundedYear`.
