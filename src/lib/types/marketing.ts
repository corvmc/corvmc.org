// Re-export marketing domain types so consumers don't import from the DB
// schema directly. The canonical definition lives next to the column that
// uses it in `#lib/server/db/schema/marketing.js`.
export type { SuppressionReason } from '#lib/server/db/schema/marketing.js';

/**
 * One recipient's copy of a sent campaign (#2777). `sent` is accepted by
 * Postmark; its event webhook moves it to delivered, bounced or complained.
 * The `skipped_` statuses are audience members the send left out (#2914).
 */
export const campaignSendStatuses = [
	'sent',
	'failed',
	'delivered',
	'bounced',
	'complained',
	'skipped_unsubscribed',
	'skipped_suppressed'
] as const;
export type CampaignSendStatus = (typeof campaignSendStatuses)[number];

/** Why an audience member got no copy: suppressed everywhere, or opted out of that audience. */
export type RecipientSkip = 'suppressed' | 'unsubscribed';
