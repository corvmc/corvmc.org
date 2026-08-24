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
	'band',
	'reservation',
	'equipment_category',
	'event',
	'campaign',
	'audience',
	'equipment',
	'inbox_thread',
	'help_categories',
	'subscriber',
	'roles',
	'permissions',
	'volunteer_role',
	'volunteer_certification',
	// references volunteer_role + event, and is referenced by volunteer_signup
	// and volunteer_hour_log, so it sits between them.
	'volunteer_shift',
	'volunteer_signup',
	// independents (no FKs)
	'closure',
	'inbox_channel_config',
	'product_config',
	'verification',
	// leaves
	'user_genre',
	'user_instrument',
	'model_has_permissions',
	'model_has_roles',
	'role_has_permissions',
	'band_genre',
	'band_slug_history',
	'campaign_audience',
	'session',
	'audience_member',
	'equipment_loan',
	'notification_preference',
	'notification',
	'account',
	'band_member',
	'payment_cache',
	'ticket',
	'event_rsvp',
	// The bill: references event and band, so it wipes before either.
	'event_band',
	'platform_invite',
	'credit_transaction',
	'help_articles',
	'band_media',
	'band_page_config',
	'inbox_message',
	'inbox_note',
	'inbox_participant',
	'content_flag',
	// After content_flag as well as user: it carries the report that cost the
	// member their standing, in whichever scope. One table where there were three
	// (community_event_standing, messaging_standing, suggestion_standing).
	'member_standing',
	'user_block',
	'suggestion',
	'suggestion_vote',
	'suggestion_edit',
	'volunteer_hour_log',
	'volunteer_profile',
	'volunteer_role_interest',
	'volunteer_shift_feedback',
	'member_certification',
	'volunteer_role_certification'
];
