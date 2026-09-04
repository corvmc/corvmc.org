// Single source of truth for D1 table dependency order (parents → children).
// Used to order data INSERTs (parent-first) and DELETEs (child-first, i.e. reversed),
// because D1 enforces foreign keys and ignores PRAGMA defer_foreign_keys on import.
//
// When the schema gains a table with foreign keys, add it here in dependency order:
// a table must appear AFTER every table it references.
export const tableOrder = [
	// roots → leaves
	'user',
	'recurring_series',
	'group',
	// Moved up from beside its votes and edits: it references only `user`, and
	// `project` references it. Position here is semantic, not cosmetic.
	'suggestion',
	// References user, group and suggestion. Must precede everything that carries
	// `project_id`: work_order, contractor_job, purchase_order, acquisition, event.
	'project',
	// References user and group; parent of directory_tag.
	'directory_entry',
	// References group.
	'band_site',
	// References user twice (subject + granter). No children.
	'instructor',
	'reservation',
	'equipment_category',
	'inventory_location',
	'inventory_item',
	'inventory_asset',
	'acquisition',
	// References user, and is the parent of purchase_order_line. Note that
	// `acquisition.purchase_order_id` carries no foreign key — adding one to an
	// existing table is a rebuild in SQLite, which on D1 would take
	// `acquisition_line` with it — so it imposes no ordering here.
	'purchase_order',
	// A root: references nothing. Parent of contractor_job.
	'contractor',
	// References contractor, inventory_asset and user, so it clears before none
	// of them.
	'contractor_job',
	'event',
	// `media` references user; `media_attachment` references media. Its
	// attachable_type/attachable_id parent link carries no foreign key by design
	// (docs/specs/shipped/media-spec.md), so it constrains nothing else in this order.
	'media',
	'media_attachment',
	'campaign',
	'audience',
	// Since band chat it also references `group` (nullable owner, null = CorvMC),
	// which is already well above this line.
	'inbox_thread',
	'help_categories',
	'subscriber',
	'roles',
	'volunteer_role',
	'volunteer_certification',
	// References user. Ahead of work_order because the shift now carries
	// `duty_list_id` — provenance for the list that stamped it out.
	'duty_list',
	// References duty_list and volunteer_role.
	'duty_list_item',
	// references volunteer_role + event + duty_list, and is referenced by
	// volunteer_signup, volunteer_hour_log and work_task, so it sits between them.
	'work_order',
	// The checklist inside one work order. References work_order and user.
	'work_task',
	'volunteer_signup',
	// independents (no FKs)
	'closure',
	'inbox_channel_config',
	'verification',
	// leaves
	'model_has_roles',
	'directory_tag',
	'group_slug_history',
	'campaign_audience',
	'session',
	'audience_member',
	'acquisition_line',
	// References purchase_order and inventory_item, so it clears before neither.
	'purchase_order_line',
	'inventory_loan',
	// References inventory_asset, inventory_loan and user. `work_order_id` points
	// at work_order but carries no foreign key -- the two schema modules
	// would otherwise import each other -- so it imposes no ordering here.
	'work_request',
	'stock_movement',
	// References inventory_item and help_article, so it clears before neither.
	'inventory_item_article',
	'notification_preference',
	'notification',
	'account',
	'group_member',
	'payment_cache',
	'ticket',
	'event_rsvp',
	// The bill: references event and band, so it wipes before either.
	'event_band',
	// Shared advertising: references event and group, so it wipes before either.
	'event_group',
	'group_invite',
	// Child of group and user, and nothing is a child of it.
	'announcement',
	// Group documents: child of group and user, nothing is a child of it.
	'file',
	// The tech rider, three deep: `rider` is a child of group and user,
	// `rider_element` of rider and user, `rider_input` of rider_element and user.
	// All three clear before `user`, which is why they sit here rather than
	// beside `band_site` up top.
	'rider',
	'rider_element',
	'rider_input',
	// The private half of a party record: child of directory_entry and
	// subscriber, so it wipes before either.
	'contact',
	// The contact-sheet link: child of directory_entry and user.
	'directory_entry_link',
	'credit_transaction',
	'help_articles',
	'inbox_message',
	'inbox_note',
	'inbox_participant',
	// The band inbox's per-reader cursor: child of inbox_thread and user.
	'inbox_group_read',
	'inbox_thread_tag',
	// Per-user saved queue filters. After user, like every other row keyed to a
	// person, and unrelated to inbox_thread — it stores filters, not threads.
	'inbox_saved_view',
	'content_flag',
	// After content_flag as well as user: it carries the report that cost the
	// member their standing, in whichever scope. One table where there were three
	// (community_event_standing, messaging_standing, suggestion_standing).
	'member_standing',
	'user_block',
	'suggestion_vote',
	'suggestion_edit',
	'volunteer_hour_log',
	'volunteer_profile',
	'volunteer_role_interest',
	'volunteer_shift_feedback',
	'member_certification',
	'volunteer_role_certification',
	// A band's Stripe Connect account. Child of group, parent of nothing.
	'band_stripe_account',
	// The audio chain, and it is a chain: release → track → radio_play, each
	// referencing the one above it, so these four keep their relative order.
	'audio_release',
	'audio_track',
	'radio_play',
	// References audio_release and user, so it clears before either.
	'release_purchase'
];

/**
 * `tableOrder` reversed — the child-first order rows must be DELETEd in — with
 * any table the database does not have skipped.
 *
 * Every full wipe goes through here rather than keeping its own copy of the
 * list. `scripts/seed-dev.ts` used to hand-maintain a second one, and it drifted:
 * `media` and `media_attachment` were never added, so `pnpm db:seed` on an
 * already-seeded database left the old rows in place and died on
 * `UNIQUE constraint failed: media.key` — an error that names the table but not
 * the cause. Deriving both callers from one list is what stops that recurring.
 *
 * Skipping absent tables rather than throwing is deliberate: a database built
 * from an older migration set is a normal thing to meet, and a table this list
 * names may simply not exist there yet.
 *
 * @param {Set<string>} present table names the database actually has.
 * @returns {string[]} tables to delete, children first.
 */
export function deleteOrder(present) {
	return [...tableOrder].reverse().filter((table) => present.has(table));
}
