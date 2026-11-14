# Event recaps

Status: ✅ /events/[id]#photos

Staff with `event.manage` add photos to a started, uncancelled event from `/staff/events/[id]` (the `gallery` slot of `media_attachment`, 60 per event, alt text and caption per photo, detach-only removal). The public event page shows them under the facts, and `/events` lists the six most recent past shows with photos as Recent recaps. A written recap paragraph (markdown, `event.manage`, #1401) sits above the photos, and its excerpt on the recap card. A show's documentation crew can upload too: a confirmed signup in a volunteer role that grants `event.uploadRecap` gets an upload form and the recap text field on that show's public page, from the shift's start until 7 days after it ends (#1500, #2544). `docs/development/business-workflows.md` §9
