// ---------------------------------------------------------------------------
// Sample models for rendering the Postmark templates locally
// ---------------------------------------------------------------------------
// One fixture per template *shape*, not per notification type — the 18 types
// that render through `notification` only differ in copy, so covering the
// combinations of optional blocks is what actually exercises the markup.
//
// Used by scripts/email-preview.ts, scripts/email-validate.ts and render.spec.ts.
// ---------------------------------------------------------------------------

export interface Fixture {
	/** Filename-safe id, also the preview page's label */
	name: string;
	/** Postmark template alias */
	alias: string;
	model: Record<string, unknown>;
}

export const FIXTURES: Fixture[] = [
	{
		name: 'notification-minimal',
		alias: 'notification',
		// Heading only — proves every other block is genuinely optional and
		// leaves no empty card, button or callout behind.
		model: {
			subject: 'Your reservation was cancelled',
			preview_text: 'Thursday, December 5 · 7:00 – 9:00 PM',
			heading: 'Reservation Cancelled'
		}
	},
	{
		name: 'notification-full',
		alias: 'notification',
		model: {
			subject: 'Practice space reminder',
			preview_text: 'Thursday, December 5, 7:00 – 9:00 PM',
			heading: "You're Booked Thursday",
			greeting: 'Hi Maya,',
			paragraphs: [
				{ text: 'You have a reservation coming up at the Collective.' },
				{ text: 'The drum kit is set up — bring cymbals and sticks.' }
			],
			has_details: true,
			details: [
				{ label: 'Room', value: 'Main Practice' },
				{ label: 'Date', value: 'Thursday, December 5' },
				{ label: 'Time', value: '7:00 PM – 9:00 PM' },
				{ label: 'Band', value: 'Indigo Kiss' },
				{ label: 'Cost', value: 'Free · 2 of 10 free hours used this month' }
			],
			cta: { url: 'https://corvmc.org/member/reservations', label: 'Manage Reservation' },
			footnote: 'Need to cancel? Do it at least 24 hours ahead so someone else can use the room.'
		}
	},
	{
		name: 'notification-with-quote',
		alias: 'notification',
		// The quote-block shape: user-generated text quoted back inside a one-way
		// notification. (The contact-form forward used to live here; it is its own
		// text-only template now — see `contact-alert` below.)
		model: {
			subject: 'A band claimed your listing',
			preview_text: 'Indigo Kiss added a note to their claim',
			heading: 'Listing Claim Submitted',
			paragraphs: [{ text: 'Indigo Kiss submitted a claim with this note:' }],
			has_details: true,
			details: [
				{ label: 'Band', value: 'Indigo Kiss' },
				{ label: 'Submitted by', value: 'Charlie Rivera' }
			],
			// Post-normalization shape: `quote` is escaped HTML, `quote_text` is the raw source.
			quote:
				'Hi there,<br /><br />I run a small folk trio &amp; we&#39;re the ones behind this listing.<br /><br />Thanks!',
			quote_text:
				"Hi there,\n\nI run a small folk trio & we're the ones behind this listing.\n\nThanks!",
			footnote: 'Review the claim in the staff dashboard.'
		}
	},
	{
		name: 'notification-escaping',
		alias: 'notification',
		// Hostile input in every escaped field. Nothing here may render as markup.
		model: {
			subject: 'Escaping check',
			preview_text: '<script>alert(1)</script>',
			heading: '<script>alert("heading")</script>',
			greeting: 'Hi <b>bold</b>,',
			paragraphs: [{ text: '<script>alert(1)</script>' }, { text: 'Ampersand & "quotes"' }],
			has_details: true,
			details: [{ label: '<b>label</b>', value: '<img src=x onerror=alert(1)>' }],
			cta: { url: 'https://corvmc.org/member', label: '<b>Go</b>' },
			footnote: '<i>footnote</i>'
		}
	},
	{
		name: 'ticket-single',
		alias: 'ticket-confirmation',
		model: {
			attendeeName: 'Maya',
			eventTitle: 'Real Book Club',
			eventDate: 'Thursday, December 5',
			eventTime: '7:00 PM',
			quantity: 1,
			multiple: false,
			preview_text: 'Real Book Club · Thursday, December 5 at 7:00 PM',
			ticketCodes: [{ code: 'CMC-4K2P-9XQ1' }],
			// Buyer declined fee coverage — the fees row should be absent.
			orderId: '7F3A9C21',
			unitPrice: '$15.00',
			subtotal: '$15.00',
			feesCovered: false,
			fees: '$0.00',
			total: '$15.00',
			// The buyer left the split bar where it opened: 30% of what is
			// divisible after the card fee, the acts take the rest.
			splitShown: true,
			toActs: '$9.98',
			toCollective: '$4.28',
			ticketsUrl: 'https://corvmc.org/events/evt-1/tickets/success?purchase_id=7f3a9c21'
		}
	},
	{
		name: 'ticket-multiple',
		alias: 'ticket-confirmation',
		model: {
			attendeeName: 'Maya',
			eventTitle: 'Winter Showcase',
			eventDate: 'Saturday, December 14',
			eventTime: '8:00 PM',
			quantity: 3,
			multiple: true,
			preview_text: 'Winter Showcase · Saturday, December 14 at 8:00 PM',
			ticketCodes: [
				{ code: 'CMC-4K2P-9XQ1' },
				{ code: 'CMC-7B3M-2LZ8' },
				{ code: 'CMC-1N9V-6RT4' }
			],
			// Buyer contributed AND covered fees — exercises both optional receipt
			// rows, and their order relative to each other.
			orderId: 'B82D5E60',
			unitPrice: '$20.00',
			subtotal: '$60.00',
			contributionMade: true,
			contribution: '$15.00',
			feesCovered: true,
			fees: '$2.55',
			total: '$77.55',
			// And dragged the bar all the way to the acts — the refusal the model
			// exists to allow, which the receipt has to state plainly rather than
			// hide because it is zero.
			splitShown: true,
			toActs: '$75.00',
			toCollective: '$0.00',
			ticketsUrl: 'https://corvmc.org/events/evt-2/tickets/success?purchase_id=b82d5e60'
		}
	},
	{
		name: 'inbox-reply',
		alias: 'inbox-reply',
		// Text-only: the recipient can reply, so it carries no layout. The body is
		// exactly what the staffer typed into the composer textarea — plain text
		// with real line breaks, and an apostrophe that must not become &#39;.
		model: {
			contactName: 'Charlie',
			subject: 'Re: Booking question',
			body: "Thanks for reaching out — March Saturdays are wide open right now.\n\nGive me two or three dates that work & I'll hold one for you.",
			staffName: 'Devon'
		}
	},
	{
		name: 'contact-alert',
		alias: 'contact-alert',
		// Text-only: staff reply to this one straight from their mail client.
		model: {
			subject: 'Contact form: Performance Inquiry',
			contactName: 'Charlie Rivera',
			contactEmail: 'charlie@example.com',
			formSubject: 'Performance Inquiry',
			replyNote:
				'Reply to this email to answer Charlie Rivera. Your reply is sent from CMC and saved on the conversation in the staff inbox.',
			message:
				"Hi there,\n\nI run a small folk trio & we're hoping to play a Saturday in March.\n\nThanks!",
			threadUrl: 'https://corvmc.org/staff/inbox/thr-1'
		}
	},
	{
		name: 'password-reset',
		alias: 'password-reset',
		// The URL better-auth builds carries a `?callbackURL=` query string, which
		// is the whole reason this template exists rather than reusing
		// `notification`: its CTA renders `{{url}}` escaped in the text part, so an
		// `&` would arrive as `&amp;`. Keep the query string in this fixture — it is
		// what makes `pnpm email:validate` and the preview prove the triple brace.
		//
		// `transactional_only` suppresses the layout's notification-preferences
		// line, and `preview_text` is set explicitly because only the
		// `notification` alias goes through `normalizeNotificationModel`.
		model: {
			greeting: 'Hi Maya,',
			resetUrl:
				'https://corvmc.org/api/auth/reset-password/PfQ2rN8xKvT1?callbackURL=%2Freset-password',
			expiresIn: '1 hour',
			preview_text: 'Choose a new password for your CorvMC account.',
			transactional_only: true
		}
	},
	{
		name: 'notification-password-changed',
		alias: 'notification',
		// The other half of the reset flow, and the one shape in the generic
		// template that carries `transactional_only`.
		model: {
			subject: 'Your CorvMC password was changed',
			preview_text: 'Your password was reset and other sessions were signed out.',
			heading: 'Your password was changed',
			greeting: 'Hi Maya,',
			paragraphs: [
				{
					text: 'The password on your Corvallis Music Collective account was just reset, and any other sessions you had open were signed out.'
				}
			],
			footnote:
				'If you did not do this, reset your password again straight away and email contact@corvmc.org so we can help.',
			transactional_only: true
		}
	}
];
