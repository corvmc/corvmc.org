# Market vendors

Status: ✅ /staff/events/[id]/vendors

A listing of kind `market` takes vendor applications. Staff set a closing date and table count, then accept (with a table) or decline. Either decision is emailed on the vendor's own inbox thread. Fees (#1502). On the day, staff or the owning committee check vendors in or mark no-shows at `/staff/events/[id]/vendors/check-in`, and record whether to invite each back; the record shows on that vendor's next application (#1505). Every market's applications are one list at `/staff/events?view=vendors`, filtered by status, each row opening its market's vendors page (#2766). A market's vendor host, on a shift in a role that grants `market.host`, decides, checks vendors in and takes table fees for that market only at `/member/volunteer/markets/[eventId]`, from the role's lead time before the market (#2993).
