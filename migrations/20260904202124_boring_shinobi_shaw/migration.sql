-- `event` is strictly the calendar advertisement — the listing a member, band or
-- staffer puts on the gig guide — so it is named for what it is. Same rows, same
-- ids: every foreign key that pointed at an event still points at the same
-- record, and SQLite rewrites the children's REFERENCES clauses itself.
--
-- One ALTER and three UPDATEs is the whole change. `drizzle-kit generate`
-- defaults its rename prompt to "create", which would emit DROP TABLE `event`
-- and cascade away event_band, event_group, event_rsvp and ticket — and
-- `d1-safe-rebuild.mjs --check` would NOT catch it, because it builds its child
-- graph from the new snapshot, where `event` no longer exists. The prompt was
-- answered through `expect`, matching the option text, and this SQL was read
-- before commit; the snapshot records `renames: ["event->event_listing"]`.
--
-- Index and check names keep their `event_` prefixes (idx_event_status_starts,
-- event_time_order, event_cmc_needs_end, ...). SQLite carries them through
-- RENAME TO untouched, and renaming them would turn a free ALTER into a table
-- rebuild. Child tables (event_band, event_group, event_rsvp) and every
-- `event_id` column stay as they are, for the same reason.
ALTER TABLE `event` RENAME TO `event_listing`;--> statement-breakpoint
-- The three columns that store the parent table's NAME as data. Drizzle's text
-- enums emit no CHECK, so nothing here fails loudly if it is missed — a
-- `booker_type = 'event'` reservation would simply stop resolving its booker and
-- vanish from the panel. Same file as the rename so the schema and the values
-- describing it move atomically. `reservation.booker_type` is documented as "a
-- table discriminator, never a category"; `media_attachment.attachable_type`
-- moved this way in the CMMS rename; `recurring_series.prototype_type` names the
-- table `prototype_id` points into.
UPDATE `reservation` SET `booker_type` = 'event_listing' WHERE `booker_type` = 'event';--> statement-breakpoint
UPDATE `media_attachment` SET `attachable_type` = 'event_listing' WHERE `attachable_type` = 'event';--> statement-breakpoint
UPDATE `recurring_series` SET `prototype_type` = 'event_listing' WHERE `prototype_type` = 'event';
