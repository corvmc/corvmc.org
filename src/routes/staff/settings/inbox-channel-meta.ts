import type { StaffInboxChannel } from '$lib/config';

/**
 * What the Inbox Channels tab says about each channel, beyond its name and icon
 * — those come from `$lib/components/inbox/channels`, which the inbox pages
 * share.
 *
 * Keyed by `StaffInboxChannel` so a channel added to that list without a row
 * here is a type error rather than a `Cannot read properties of undefined`
 * behind the settings page's error boundary, which is how `direct` blanked the
 * whole page. Its own file so the coverage is testable without rendering the
 * page.
 */
export const inboxChannelMeta: Record<StaffInboxChannel, { description: string; envHint: string }> =
	{
		email: {
			description: 'Receive and reply to emails via Postmark',
			envHint: 'POSTMARK_SERVER_TOKEN, POSTMARK_INBOUND_TOKEN'
		},
		sms: {
			description: 'Send and receive text messages via Twilio',
			envHint: 'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER'
		},
		web: {
			description: 'Receive messages from the public contact form',
			envHint: 'Always enabled'
		},
		portal: {
			description: 'Members message staff from their member portal',
			envHint: 'Always enabled'
		},
		instagram: {
			description: 'Receive and reply to Instagram direct messages',
			envHint: 'META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN'
		},
		messenger: {
			description: 'Receive and reply to Facebook Messenger messages',
			envHint: 'META_APP_SECRET, META_VERIFY_TOKEN, META_PAGE_ACCESS_TOKEN'
		}
	};
