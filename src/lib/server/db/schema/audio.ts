import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { releaseKinds } from '../../../config';
import { group } from './group';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------
// `releaseKinds` lives in config because the band panel's select renders its
// labels. Everything below is read only by the server, so it stays here —
// see conventions.md § "Where a status enum lives".

/**
 * `withheld` is the moderation state, kept distinct from `draft` so a takedown
 * cannot be undone by the band clicking Publish again. Unpublishing your own
 * work and having it unpublished for you are different facts.
 */
export const releaseStatuses = ['draft', 'published', 'withheld'] as const;
export type ReleaseStatus = (typeof releaseStatuses)[number];

/**
 * A purchase is `paid` when money (or nothing, for a free release) has settled.
 * The finance module's rule is that "has a Stripe Payment Record" *is* payment
 * status; this column exists for the second question that rule cannot answer —
 * which abandoned rows the stale sweep may delete — exactly as `ticket.status`
 * sits beside `ticket.stripePaymentRecordId` for the same reason.
 */
export const purchaseStatuses = ['pending', 'paid', 'refunded'] as const;
export type PurchaseStatus = (typeof purchaseStatuses)[number];

// ---------------------------------------------------------------------------
// Releases and tracks
// ---------------------------------------------------------------------------

/**
 * A record a band put out: a single, an EP, an album.
 *
 * The unit of *sale* and the unit of *publication*, which is why price and
 * radio consent both live here rather than on the track. A band decides once
 * per record whether it is for sale and whether it is on the air; deciding it
 * eleven times per album is the kind of prompt people answer wrong.
 *
 * Cover art is not a column. It hangs off `media_attachment` under
 * `attachableType: 'audio_release'`, slot `'cover'`, so it shares the sweep and
 * the transform pipeline every other image in the app already uses.
 *
 * See docs/specs/band-audio-spec.md.
 */
export const audioRelease = sqliteTable(
	'audio_release',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		groupId: text('group_id')
			.notNull()
			.references(() => group.id, { onDelete: 'cascade' }),

		title: text('title').notNull(),
		/** Unique within the band, not globally — two bands may both have a "Demos". */
		slug: text('slug').notNull(),
		kind: text('kind', { enum: releaseKinds }).notNull().default('single'),
		description: text('description'),

		/**
		 * The date the band says the record came out, which is frequently long
		 * before the day they uploaded it. Distinct from `publishedAt` for that
		 * reason: one orders the discography, the other is an audit fact.
		 */
		releasedAt: integer('released_at', { mode: 'timestamp' }),

		status: text('status', { enum: releaseStatuses }).notNull().default('draft'),

		/**
		 * The floor a buyer may name, in cents. `0` means free — and free is not a
		 * degenerate case here, it is the path a band takes when it wants a catalog
		 * page and a spot in the rotation without ever opening a Stripe account.
		 * Values between 1 and `AUDIO_MIN_PRICE_CENTS` are rejected by the service.
		 */
		priceMinCents: integer('price_min_cents').notNull().default(0),
		/** Whether the buyer may pay above the floor. Off makes it a fixed price. */
		allowPayMore: integer('allow_pay_more', { mode: 'boolean' }).notNull().default(true),

		/** The band's consent to be broadcast. Independent of whether it sells. */
		radioOptIn: integer('radio_opt_in', { mode: 'boolean' }).notNull().default(false),

		/**
		 * The staff veto, as a timestamp rather than a boolean so "pulled from the
		 * rotation" carries when. Deliberately separate from `radioOptIn`: staff
		 * pulling a record must not read as the band withdrawing consent, and
		 * clearing the veto must not silently re-broadcast something the band
		 * itself opted out of in the meantime.
		 */
		radioExcludedAt: integer('radio_excluded_at', { mode: 'timestamp' }),
		radioExcludedReason: text('radio_excluded_reason'),

		publishedAt: integer('published_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),

		/**
		 * A release with paid purchases is soft-deleted and never removed, because
		 * its buyers' downloads hang off it. Same reasoning that keeps a `band_site`
		 * row alive through a lapsed subscription: money already changed hands, so
		 * the content is no longer only the band's to withdraw.
		 */
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(t) => [
		uniqueIndex('idx_audio_release_group_slug').on(t.groupId, t.slug),
		index('idx_audio_release_group').on(t.groupId),
		index('idx_audio_release_status').on(t.status)
	]
);

export type AudioRelease = typeof audioRelease.$inferSelect;

/**
 * One recording, and one object in the **private** bucket.
 *
 * `objectKey` is a bare column rather than a `media` row on purpose. `media` is
 * public-bucket-shaped in every direction that matters — `getPublicUrl()` will
 * mint a `media.corvmc.org` address for any key handed to it and cannot tell
 * which bucket the key came from, and the sweep enumerates `R2_BUCKET`. Putting
 * a private key in that table would leave every master one autocomplete away
 * from being published, which is the precise hazard `private-storage.ts` was
 * split out to prevent.
 *
 * Nothing shares these objects the way 52 occurrences of a series share one
 * poster, so the reference counting `media` exists to do has nothing to count:
 * deleting a track deletes its object outright. The sweep still gets a pass over
 * the prefix, for uploads that failed between the R2 write and this insert.
 */
export const audioTrack = sqliteTable(
	'audio_track',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		releaseId: text('release_id')
			.notNull()
			.references(() => audioRelease.id, { onDelete: 'cascade' }),

		title: text('title').notNull(),
		trackNumber: integer('track_number').notNull(),

		/**
		 * Stored rather than derived because the radio scheduler builds a wall-clock
		 * timetable out of it — it has to know how long a record runs before it
		 * plays, and it has no file to ask.
		 */
		durationMs: integer('duration_ms').notNull(),

		/** The key in `R2_PRIVATE`. Never returned to a client, in any shape. */
		objectKey: text('object_key').notNull(),
		contentType: text('content_type').notNull(),
		byteSize: integer('byte_size').notNull(),
		/** The uploader's filename, kept for the buyer's `Content-Disposition`. */
		originalFilename: text('original_filename'),

		/** Unset today; here because royalty reporting asks for it and it is free to carry. */
		isrc: text('isrc'),

		/** Track-level staff veto — pulls one recording without pulling the record. */
		radioExcludedAt: integer('radio_excluded_at', { mode: 'timestamp' }),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		uniqueIndex('idx_audio_track_release_number').on(t.releaseId, t.trackNumber),
		// The sweep's index: reconciling a prefix listing against live rows asks
		// whether any track still claims this key.
		uniqueIndex('idx_audio_track_key').on(t.objectKey)
	]
);

export type AudioTrack = typeof audioTrack.$inferSelect;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * A band's own Stripe account, so sales pay out to the band and not to CMC.
 *
 * Its own table rather than columns on `group`, for the reason `band_site` is
 * its own table: `group` is what a band *is*, and a payout account is neither
 * that nor something it bought. Keyed by `groupId` because one band has exactly
 * one account or none — the absent row is the "not set up yet" state, which is
 * why nothing here is nullable-with-a-default.
 *
 * Every flag below is Stripe's answer, mirrored from `account.updated`, and is
 * never written by the app. `chargesEnabled` is the one that gates selling;
 * `requirementsJson` is what the band still owes Stripe, shown verbatim so the
 * "finish setting up payouts" prompt can say what is actually missing.
 */
export const bandStripeAccount = sqliteTable('band_stripe_account', {
	groupId: text('group_id')
		.primaryKey()
		.references(() => group.id, { onDelete: 'cascade' }),

	stripeAccountId: text('stripe_account_id').notNull(),

	chargesEnabled: integer('charges_enabled', { mode: 'boolean' }).notNull().default(false),
	payoutsEnabled: integer('payouts_enabled', { mode: 'boolean' }).notNull().default(false),
	detailsSubmitted: integer('details_submitted', { mode: 'boolean' }).notNull().default(false),

	/** Stripe's `requirements.currently_due` et al, stored as it arrives. */
	requirementsJson: text('requirements_json', { mode: 'json' }).$type<unknown>(),

	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});

export type BandStripeAccount = typeof bandStripeAccount.$inferSelect;

/**
 * One buyer, one release, one download entitlement.
 *
 * The three money columns are stored rather than recomputed because the buyer
 * *chose* two of them on the split bar. A recomputation would answer "what
 * would this cost today" — the wrong question when a band is reconciling a
 * Stripe deposit against what a buyer was shown six months ago, or when the
 * suggested take has since moved. They are also exactly what was handed to
 * Stripe: `platformFeeCents + the processing fee` was the `application_fee_amount`.
 *
 * `userId` is nullable and `buyerEmail` is not, because the download identity is
 * the address, not the account. Anonymous purchase is the common case for a
 * record shared on a flyer, and demanding a login first is how that sale is lost.
 */
export const releasePurchase = sqliteTable(
	'release_purchase',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		releaseId: text('release_id')
			.notNull()
			.references(() => audioRelease.id, { onDelete: 'cascade' }),

		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		buyerEmail: text('buyer_email').notNull(),

		/** Groups rows bought together, matching the `ticket` convention. No order table. */
		purchaseId: text('purchase_id').notNull(),

		/** What the buyer was actually charged, fee coverage included. */
		amountPaidCents: integer('amount_paid_cents').notNull(),
		/** The share the buyer left to the collective. May legitimately be zero. */
		platformFeeCents: integer('platform_fee_cents').notNull(),
		/** What Stripe transferred to the band's account. */
		bandNetCents: integer('band_net_cents').notNull(),
		/** Nonzero when the buyer ticked "cover processing". */
		feeCoveredCents: integer('fee_covered_cents').notNull().default(0),

		/**
		 * Both, and not by accident. The rest of the app treats the Payment Record
		 * as proof of payment; a Connect refund needs the PaymentIntent, because
		 * reversing a transfer and refunding an application fee are operations on
		 * the charge rather than on the record that describes it.
		 */
		stripePaymentIntentId: text('stripe_payment_intent_id'),
		stripePaymentRecordId: text('stripe_payment_record_id'),

		status: text('status', { enum: purchaseStatuses }).notNull().default('pending'),

		/**
		 * The emailed link. Random and unguessable, because for an anonymous buyer
		 * it is the *only* handle on what they bought — there is no account to log
		 * back into.
		 */
		downloadToken: text('download_token').notNull(),
		downloadCount: integer('download_count').notNull().default(0),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		paidAt: integer('paid_at', { mode: 'timestamp' })
	},
	(t) => [
		uniqueIndex('idx_release_purchase_token').on(t.downloadToken),
		index('idx_release_purchase_release').on(t.releaseId),
		index('idx_release_purchase_user').on(t.userId),
		index('idx_release_purchase_email').on(t.buyerEmail),
		// The stale sweep's read: pending rows older than the abandonment window.
		index('idx_release_purchase_status').on(t.status, t.createdAt)
	]
);

export type ReleasePurchase = typeof releasePurchase.$inferSelect;

// ---------------------------------------------------------------------------
// Radio
// ---------------------------------------------------------------------------

/**
 * The station's timetable, and the fifth append-only ledger in the schema.
 *
 * One table answers four questions that would otherwise be four mechanisms:
 * what is on now (the row spanning `now`), what is next (the rows after it),
 * what just played (the rows before it), and what to play least often (the
 * scheduler's own read of its history). Cron tops it up ahead of wall clock;
 * nothing ever updates a row.
 *
 * That a schedule is materialized rather than derived from a seeded shuffle is
 * the decision worth knowing. A deterministic shuffle needs no writes, but the
 * pool changes underneath it — a band opting out at 4pm would silently
 * re-deal every listener's evening. Rows already handed out do not move.
 */
export const radioPlay = sqliteTable(
	'radio_play',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),

		trackId: text('track_id')
			.notNull()
			.references(() => audioTrack.id, { onDelete: 'cascade' }),

		startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
		/** `startsAt + durationMs`, denormalized so "what is on now" is one range scan. */
		endsAt: integer('ends_at', { mode: 'timestamp' }).notNull(),

		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		// Every read is a window over wall clock, forwards or backwards.
		index('idx_radio_play_starts').on(t.startsAt),
		// The scheduler's anti-repetition read: when did this track last play.
		index('idx_radio_play_track').on(t.trackId, t.startsAt)
	]
);

export type RadioPlay = typeof radioPlay.$inferSelect;
