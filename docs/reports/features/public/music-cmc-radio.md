# Music + CMC Radio

Status: ✅ Public pages

`/music/[bandSlug]/[releaseSlug]` — cover, full free streaming, and a Humble-Bundle-style split bar where the buyer divides their payment between the band and the collective (CMC's share is refusable down to zero, and at zero the collective nets nothing and loses nothing). `/music/download/[token]` is the entitlement — no session, because a guest buyer has nothing else. `/radio` is the station: one synchronized rotation, materialized into `radio_play` by cron, with a dismissible player mounted in the ROOT layout so it survives navigation. Behind `bandAudio` / `cmcRadio`. See `docs/decisions/0027-band-music-sells-files-and-the-radio-plays-a-timetable.md`
