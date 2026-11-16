# Calendar feeds

Status: ✅ /events/calendar.ics, /events/feed.xml

The gig guide, syndicated (#596). A subscribable iCalendar feed (published + cancelled listings from a month back to a year ahead; cancelled shows carry `STATUS:CANCELLED`, UIDs match the per-event download) and an RSS 2.0 feed of the next 100 upcoming listings. Linked from `/events` under the mini-calendar as a `webcal:` subscription. Built with `ical-generator` and `feed`. Partner feed _imports_ are not built.
