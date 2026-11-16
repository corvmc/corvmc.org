# Reservations list + detail

Status: ✅ Full CRUD

Create, cancel, no-show, cash-received, day-grouped table. One filter row: booker type joined to search, a Date preset (From today, Next 7 days, Past 30 days, Any date, custom), and Status with per-option counts; Payment due is ended-and-owing plus upcoming unpaid, and a dot on Status flags any ended session still owing. A session that ended owing carries Cash received and No-show on its row. Filters live in the URL. An event's space hold names the event and links to `/staff/events/[id]` instead of the staff account that raised it — on the row and on the detail page, whose lead card becomes Event · Booked by; search matches event titles alongside member and band names. Rows lead with the booker, then the hour: a member's first non-cancelled booking carries a first-visit flag so the desk can put a volunteer on it (list and detail agree, via `isFirstReservationSql`), and a booking the member left a note on says so without a click
