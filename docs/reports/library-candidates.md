# Library candidates for unbuilt work

> Packages surveyed while writing up features that do not exist yet — what each would
> accelerate, and which were rejected. Split out of `IDEAS.md` when that file was retired
> into GitHub Issues; the ideas themselves became `enhancement` issues, and this table did
> not, because a library evaluation is not a work item.
>
> **Not the same as the feature catalog's [Library decisions](feature-catalog.md#library-decisions)**,
> which records what the app actually depends on and why. This is the shortlist for things
> not yet built, including the entries that concluded nothing good exists.
>
> **Status: reference.** Downloads/wk figures are as surveyed and were not re-checked.

Existing npm packages that could accelerate building these features. Grouped by area.

### Image Processing & Poster Compositing

| Package           | Downloads/wk | Use                                                                                     |
| ----------------- | ------------ | --------------------------------------------------------------------------------------- |
| `sharp`           | 66M          | Server-side image compositing, watermarking, thumbnails, format conversion              |
| `@napi-rs/canvas` | 12M          | Full Canvas 2D API in Node — rich text rendering, complex layouts for poster generation |
| `satori`          | 1.3M         | HTML+CSS to SVG — template-driven poster design, pipe through sharp for raster output   |
| `photoswipe`      | 510K         | Client-side lightbox for photo galleries — lightweight, touch/gesture support           |

### Calendar & Scheduling

| Package                | Downloads/wk | Use                                                                  |
| ---------------------- | ------------ | -------------------------------------------------------------------- |
| `ical-generator`       | 468K         | Generate .ics feeds for event syndication                            |
| `node-ical`            | 163K         | Parse partner .ics feeds for import                                  |
| `feed`                 | 1.2M         | Generate RSS/Atom feeds for event syndication                        |
| `@event-calendar/core` | 23K          | Svelte-native calendar display — day/week/month views, drag-and-drop |
| `@schedule-x/svelte`   | 121K         | Calendar with official Svelte adapter — modern alternative           |

### Audio & Streaming

| Package          | Downloads/wk | Use                                                                         |
| ---------------- | ------------ | --------------------------------------------------------------------------- |
| `wavesurfer.js`  | 881K         | Waveform visualization + playback for music store                           |
| `howler.js`      | 777K         | Cross-browser audio playback, playlists — simpler alternative to wavesurfer |
| `music-metadata` | 1.9M         | Server-side ID3/metadata extraction — feeds ASCAP/BMI compliance logs       |
| `hls.js`         | 5.3M         | HLS playback in browsers for web radio streaming                            |

### Forum & Content

| Package           | Downloads/wk | Use                                                  |
| ----------------- | ------------ | ---------------------------------------------------- |
| `marked`          | 42M          | Markdown to HTML for forum posts — fast, lightweight |
| `rehype-sanitize` | 4.9M         | Sanitize user-generated HTML — pair with marked      |
| `minisearch`      | 1.2M         | Client-side full-text search for forum/help articles |

### PDF & Reporting

| Package         | Downloads/wk | Use                                                               |
| --------------- | ------------ | ----------------------------------------------------------------- |
| `csv-stringify` | 9.7M         | CSV export. No runtime deps; use `csv-stringify/browser/esm/sync` |
| `chart.js`      | 12.8M        | Charts — but see the note on SSR below before picking a library   |

**`puppeteer` and `pdfkit` were listed here and are wrong for this stack.** Puppeteer cannot run
inside a Cloudflare Worker at all; the platform answer for HTML → PDF is **Cloudflare Browser
Rendering** (a `/pdf` REST endpoint or the binding), which needs no npm dependency. A print
stylesheet over the report page comes first either way — see `docs/specs/reporting-spec.md`.

Two things to know before adding either of the above:

- **`csv-stringify` must be configured with `escape_formulas`.** It does not escape a leading `=`,
  `+`, `-` or `@` by default, and neither does PapaParse — CSV formula injection is the reason to
  take the dependency rather than hand-rolling the quoting. The `src/lib/server/report/csv.ts`
  wrapper forces the flag on so no call site can forget it.
- **A charting library is not yet chosen, and the constraint is SSR.** The board packet is a print
  artifact, so a library that emits SVG without a browser DOM wins. `chart.js` and Observable Plot
  both assume a DOM; LayerChart is Svelte-native and worth testing first.

### Stage Plot & Drawing

| Package  | Downloads/wk | Use                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `konva`  | 1.7M         | 2D canvas with drag-and-drop shapes. **Considered and not taken** for the band stage plot (Sep 2026): a canvas draws pixels, not focusable controls, so the keyboard and screen-reader path — which `SplitBar` makes non-optional — would have been built beside it. A dozen absolutely-positioned buttons were less code and inherit the theme and print stylesheet |
| `fabric` | 796K         | Canvas with object model + SVG export — heavier but more drawing features                                                                                                                                                                                                                                                                                            |

### Inventory & Scanning

| Package            | Downloads/wk | Use                                                                    |
| ------------------ | ------------ | ---------------------------------------------------------------------- |
| `barcode-detector` | 1.5M         | **Adopted.** Camera scanning — ZXing-C++ via wasm, actively maintained |
| `bwip-js`          | 572K         | Generate barcode/QR labels for printing                                |

`barcode-detector` is wired into tag binding, the inventory search and loan
checkout, always beside the field it fills rather than in place of it — a USB
wedge scanner types into those fields already, and a member scanning a tag uses
their phone's own camera, which resolves the `/a/{tag}` URL with no app.

`bwip-js` is **not** adopted, and may never need to be. `docs/specs/inventory-spec.md`
settles that serialized tags are bought pre-printed rather than generated; the
only printing left is consumable bin labels, and `qrcode-svg` is already a
dependency for event tickets.

### Drag & Drop / Pipeline UI

| Package             | Downloads/wk | Use                                                                   |
| ------------------- | ------------ | --------------------------------------------------------------------- |
| `svelte-dnd-action` | 134K         | Svelte-native DnD — kanban boards for booking pipeline, grant tracker |

### No Good Library Found (yet)

Areas where the npm ecosystem is thin — worth revisiting periodically.

- **Voting / Ranked Choice** — no well-maintained package exists; `nanoid` can generate ballot IDs
- **Affiliate Tracking** — no turnkey solution; `nanoid` or `hashids` for referral codes, rest is custom
- **Shift Scheduling UI** — no standalone package; build on top of a calendar component
- **Authorization** — nothing new is needed. `better-auth` already ships `createAccessControl`
  (statements of resource → actions, roles composed from them, assignment in the DB), which is
  the shape `docs/specs/admin-vs-staff-spec.md` settles on. The heavyweight tier — OpenFGA and
  SpiceDB for Zanzibar-style ReBAC, Cedar/Casbin/Oso as embedded policy languages — pays off
  past roughly twenty roles or when resource sharing is a product feature. This is eight
  positions and one relationship type, inside a Worker where an external check is a network hop.
  `better-auth`'s **organization plugin** was evaluated for the committee half and rejected:
  teams carry no per-team permissions and `hasPermission` is organization-scoped only, so a
  committee would have to become an organization — which turns every band into one too and adds
  tenant-switching session state this app has no use for. Its `organizationRole` table (a
  role scoped to one group, permissions as JSON, created at runtime) is the shape to copy if
  committees ever want their own internal positions

---
