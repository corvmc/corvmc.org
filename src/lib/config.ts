import type { CreditType } from '$lib/server/db/schema/finance';
import type { PricingTier } from '$lib/server/db/schema/equipment';

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/** Site name appended to every document title, as `<page> | <SITE_NAME>`. */
export const SITE_NAME = 'Corvallis Music Collective';

/** Build a document title. Pass nothing for the bare site name. */
export function pageTitle(title?: string): string {
	return title ? `${title} | ${SITE_NAME}` : SITE_NAME;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const SEARCH_LIMIT = 20;
export const LIST_LIMIT = 100;

// ---------------------------------------------------------------------------
// Text field limits
// ---------------------------------------------------------------------------
//
// These are *application* conventions, not database constraints — every text
// column in the schema is a bare SQLite `text()` with no length at all. The 255
// is inherited from the Laravel/MySQL app this replaced, where it meant
// varchar(255). Kept because it is a sane cap and changing it would be churn,
// but do not read it as something the database enforces.
//
// Named per *kind of field*, deliberately, rather than one constant reused
// everywhere the number happens to be the same. A shared constant asserts that
// two fields must change together; that is true of "every single-line name in
// the app" and false of, say, a flag reason, which has its own limit next to
// the rest of the flag rules.

/** Single-line text: names, titles, slugs, locations. */
export const SHORT_TEXT_MAX = 255;

/** A one-or-two-sentence field: summaries, short bios, availability notes. */
export const BLURB_MAX = 500;

/** Multi-paragraph prose: descriptions, longer bios. */
export const LONG_TEXT_MAX = 2000;

/** Free-text staff/member notes attached to a record. */
export const NOTES_MAX = 1000;

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export const DOLLARS_PER_UNIT = 5;

// Free-hours credits are stored as 30-minute blocks: one credit covers half an
// hour of practice-room time. The credit currency lives in the data layer (DB,
// services, remotes); the UI presents it as hours via `creditsToHours`, and the
// money path values one credit at half the hourly room rate.
export const MINUTES_PER_CREDIT = 30;

/** Convert a credit count (30-min blocks) to display hours. 24 → 12. */
export function creditsToHours(credits: number): number {
	return (credits * MINUTES_PER_CREDIT) / 60;
}

/** Convert hours of room time to credits (30-min blocks). 1.5h → 3. */
export function hoursToCredits(hours: number): number {
	return Math.round((hours * 60) / MINUTES_PER_CREDIT);
}

/** Cents value of one free-hours credit at a given hourly room rate. */
export function creditValueCents(hourlyRateCents: number): number {
	return Math.round((hourlyRateCents * MINUTES_PER_CREDIT) / 60);
}

// Equipment credits are denominated in cents (1 credit = 1¢ of equipment-loan
// charge), granted 1:1 with the member's monthly contribution. The cap bounds
// rollover hoarding — 25000 = $250 of accrued credit.
export const creditTypeConfig: Record<CreditType, { maxBalance: number | null }> = {
	free_hours: { maxBalance: null },
	equipment_credits: { maxBalance: 25000 }
};

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

/**
 * How many days before its start a member may confirm a reservation *without* a
 * Stripe prepayment. Outside this window only a real Stripe charge (or staff)
 * can confirm. Bounds how far ahead reservations sit confirmed (the single lock
 * has finite user slots) and cuts no-shows.
 */
export const CONFIRMATION_WINDOW_DAYS = 3;

/** The earliest instant a member may confirm a reservation starting at `startsAt`. */
export function confirmWindowOpensAt(startsAt: Date): Date {
	return new Date(startsAt.getTime() - CONFIRMATION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** Whether `now` is inside the member confirmation window for `startsAt`. */
export function withinConfirmationWindow(startsAt: Date, now: Date = new Date()): boolean {
	return now.getTime() >= confirmWindowOpensAt(startsAt).getTime();
}

// ---------------------------------------------------------------------------
// Equipment pricing
// ---------------------------------------------------------------------------

export const DAILY_RATE_MAJOR = 500;
export const DAILY_RATE_ACCESSORY = 100;

/** Daily loan rate in cents; accessories are free for sustaining members. */
export function loanDailyRateCents(pricingTier: PricingTier, isSustainingMember: boolean): number {
	if (pricingTier === 'accessory' && isSustainingMember) return 0;
	return pricingTier === 'major' ? DAILY_RATE_MAJOR : DAILY_RATE_ACCESSORY;
}

/** Chargeable loan days: started 24-hour blocks from pickup, minimum one day. */
export function loanChargeDays(from: Date, to: Date): number {
	return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
}

// Single formula shared with settlement (loan-service calculateLoanCharge) so
// the quoted estimate and the final charge can only differ by actual
// checkout/return times, never by a different rate or rounding rule.
export function estimateLoanCost(
	pickupDate: Date,
	returnDate: Date,
	pricingTier: PricingTier,
	isSustainingMember: boolean
): number {
	return (
		loanDailyRateCents(pricingTier, isSustainingMember) * loanChargeDays(pickupDate, returnDate)
	);
}

// ---------------------------------------------------------------------------
// Equipment enum values (used in UI dropdowns)
// ---------------------------------------------------------------------------

export const equipmentConditions = ['excellent', 'good', 'fair', 'poor'] as const;

/**
 * Condition is an ordinal scale, so it gets colour rather than four identical
 * ghost badges. Keyed by the same values as `equipmentConditions` — keep in sync.
 */
export const equipmentConditionBadge: Record<(typeof equipmentConditions)[number], string> = {
	excellent: 'badge-success',
	good: 'badge-info',
	fair: 'badge-warning',
	poor: 'badge-error'
};

export const equipmentStatuses = ['available', 'maintenance', 'retired'] as const;
export const pricingTiers = ['major', 'accessory'] as const;
export const loanStatuses = [
	'requested',
	'scheduled',
	'checked_out',
	'returned',
	'cancelled'
] as const;

// ---------------------------------------------------------------------------
// Credit transaction sources
// ---------------------------------------------------------------------------

/**
 * Display labels for `transactionSources`
 * (src/lib/server/db/schema/finance.ts). Kept here rather than in the schema so
 * the staff credits page can import it without pulling in server code.
 * `creditSourceLabels.spec.ts` asserts it stays exhaustive.
 */
export const creditSourceLabels: Record<string, string> = {
	monthly_allocation: 'Monthly allocation',
	checkout: 'Checkout',
	checkout_failed: 'Checkout failed',
	refund: 'Refund',
	cancelled: 'Cancelled',
	admin_adjustment: 'Admin adjustment',
	reservation: 'Reservation'
};

// ---------------------------------------------------------------------------
// Inbox enum values
// ---------------------------------------------------------------------------

export const inboxChannels = [
	'email',
	'sms',
	'web',
	'portal',
	'direct',
	'instagram',
	'messenger'
] as const;

/**
 * The contact-form subject that reveals the event-tip fields.
 *
 * Here rather than beside the schema it validates: the public contact page has
 * to branch on it, and anything under `$lib/server/**` is barred from the
 * browser bundle.
 */
export const EVENT_TIP_SUBJECT = 'Event Tip';
export const inboxThreadStatuses = ['open', 'resolved', 'snoozed'] as const;
/**
 * Which way a message went, relative to CorvMC. `inbound` is someone writing to
 * us; `outbound` is us writing back, and is what we are responsible for
 * delivering. `peer` is neither: a member↔member message that we only hold.
 *
 * Keeping `peer` out of `inbound` matters — `addOutboundMessage` builds its
 * email References chain from `direction = 'inbound'`, and anything measuring
 * staff response times counts the same rows. Neither should see a DM.
 */
export const inboxMessageDirections = ['inbound', 'outbound', 'peer'] as const;

/**
 * How a participant relates to a thread. Only threads with signed-in parties
 * have participants at all — the outward channels identify their contact by
 * email/phone/external id, denormalized onto the thread.
 */
export const inboxParticipantRoles = ['member', 'staff'] as const;

/**
 * Channels with no external system behind them: nothing to authenticate, so
 * nothing to turn off. The contact form and the member portal both deliver
 * through the site itself. Lives here rather than in the inbox service so the
 * settings page can ask the same question the server does.
 */
export const alwaysEnabledInboxChannels: readonly (typeof inboxChannels)[number][] = [
	'web',
	'portal'
];

/** How many people may be sitting on an unanswered request from you at once. */
export const MAX_PENDING_SENT_REQUESTS = 5;

/** How many of your reports may be waiting in the staff queue at once. */
export const MAX_UNRESOLVED_REPORTS = 5;

/** Longest a single direct message may be. */
export const DIRECT_MESSAGE_BODY_MAX = 5000;

export function isAlwaysEnabledChannel(channel: string): boolean {
	return (alwaysEnabledInboxChannels as readonly string[]).includes(channel);
}

// ---------------------------------------------------------------------------
// Member standing
// ---------------------------------------------------------------------------

/**
 * The privileges a member can be put on probation for, one per domain that
 * reads standing. Exactly three, and each one has a code path that consults it
 * — a scope nothing reads is a column that lies. `member_profile` and
 * `band_profile` reports cost nobody anything on uphold today, so they get no
 * scope; `scopeForFlag` maps them to null.
 */
export const standingScopes = ['community_event', 'suggestion', 'messaging'] as const;
export type StandingScope = (typeof standingScopes)[number];

/**
 * One ladder for every scope.
 *
 * `none`       — no restriction. Also what a lifted one becomes, so "we looked
 *                at this and cleared it" still reads differently from "this
 *                never came up".
 * `restricted` — you may still act, but with a gate. For the two posting
 *                scopes that gate is staff review; for messaging it is
 *                reply-only.
 * `disabled`   — you may not act at all.
 */
export const standingStatuses = ['none', 'restricted', 'disabled'] as const;
export type StandingStatus = (typeof standingStatuses)[number];

/**
 * Which rungs each scope may actually hold, and what to call it on screen.
 *
 * Only messaging has a use for `disabled` — staff switching it off wholesale,
 * which is how the occasional under-18 member is handled. "You may not post
 * community listings at all" is not a thing anyone can do, so `setStanding`
 * rejects it rather than leaving an unreachable value lying in the column.
 */
export const standingScopeConfig: Record<
	StandingScope,
	{ statuses: readonly StandingStatus[]; label: string }
> = {
	community_event: { statuses: ['none', 'restricted'], label: 'Community listings' },
	suggestion: { statuses: ['none', 'restricted'], label: 'Suggestions' },
	messaging: { statuses: ['none', 'restricted', 'disabled'], label: 'Direct messages' }
};

/**
 * Longest staff note stored on a standing. 500 was already the cap on both the
 * staff messaging form and `revokeSuggestionTrust`; community listings trimmed
 * nowhere, which was the outlier.
 */
export const STANDING_REASON_MAX = 500;

// ---------------------------------------------------------------------------
// Volunteering
// ---------------------------------------------------------------------------

export const volunteerHourStatuses = ['pending', 'approved', 'rejected'] as const;

/**
 * The DB says `rejected`, but nothing user-facing does: staff return a log for
 * correction and the member logs it again, which "rejected" reads as final. The
 * stored value is unchanged — this is the display layer only.
 */
export const volunteerHourStatusLabels: Record<(typeof volunteerHourStatuses)[number], string> = {
	pending: 'Pending',
	approved: 'Approved',
	rejected: 'Returned'
};

/**
 * How a role is grouped when roles are shown as a list to choose from. Purely
 * presentational — nothing branches on it. Committee work is volunteering that
 * happens in a monthly meeting rather than at the space, which is why it reads
 * as its own group rather than as more "away from shows".
 */
export const volunteerRoleGroups = ['at-shows', 'away-from-shows', 'committee'] as const;

export const volunteerRoleGroupLabels: Record<(typeof volunteerRoleGroups)[number], string> = {
	'at-shows': 'At shows',
	'away-from-shows': 'Away from shows',
	committee: 'Committees'
};

/**
 * A volunteer profile is `active` or it is not. There is exactly one reason to be
 * `blocked` today — an under-18 self-signup — and it always means "a person has to
 * look at this", so `blocked` doubles as the staff review queue.
 *
 * Minor-ness is a separate fact (`isAdult`), not a status. Staff still need it
 * after they approve someone, and folding the two together would lose it at the
 * exact moment the override runs.
 */
export const volunteerProfileStatuses = ['active', 'blocked'] as const;

export const volunteerProfileStatusLabels: Record<
	(typeof volunteerProfileStatuses)[number],
	string
> = {
	active: 'Active',
	// "Blocked" reads as a punishment for answering honestly. Staff are being
	// asked to make contact, not to police anyone.
	blocked: 'Needs review'
};

/** First and last name on a volunteer profile. Matches VOLUNTEER_ROLE_NAME_MAX. */
export const VOLUNTEER_NAME_MAX = 100;

/** The free-text "when am I around" note. A sentence or two, not an essay. */
export const VOLUNTEER_AVAILABILITY_MAX = 500;

/** How many roles one member may express interest in — every role and then some. */
export const VOLUNTEER_MAX_INTERESTS = 50;

/**
 * How far back a member may backdate an hour log. Too tight and someone loses a
 * busy season's hours after a stretch of not logging; too loose and the "this
 * quarter" figure keeps moving under the board.
 */
export const VOLUNTEER_BACKDATE_LIMIT_DAYS = 90;

/** 12 hours. The DB check constraint backstops at 24. */
export const VOLUNTEER_MAX_MINUTES_PER_LOG = 720;

export const VOLUNTEER_DESCRIPTION_MAX = 1000;
export const VOLUNTEER_REVIEW_NOTES_MAX = 1000;
export const VOLUNTEER_ROLE_NAME_MAX = 100;
export const VOLUNTEER_ROLE_DESCRIPTION_MAX = 2000;

/** Hours a member may enter per log, as a step for the number input. */
export const VOLUNTEER_HOUR_STEP = 0.25;

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

/**
 * The same words `reservationStatuses` uses for the same states, deliberately:
 * a shift claim and a room booking move through the same shape, and two
 * vocabularies for one lifecycle is a tax on everyone reading the code.
 *
 * `claimed` is a member putting their hand up; `confirmed` is staff saying yes.
 */
export const volunteerSignupStatuses = [
	'claimed',
	'confirmed',
	'completed',
	'cancelled',
	'no_show'
] as const;
export type VolunteerSignupStatus = (typeof volunteerSignupStatuses)[number];

/** A single shift can't run longer than a day — a typo'd end date, not a real shift. */
export const VOLUNTEER_SHIFT_MAX_MINUTES = 1440;

/** How many people one shift can ask for. Higher than any real call. */
export const VOLUNTEER_SHIFT_MAX_CAPACITY = 50;

export const VOLUNTEER_SHIFT_NOTES_MAX = 1000;

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

/** A card inside this window of expiry reads as "expiring soon" rather than current. */
export const CERT_EXPIRY_WARNING_DAYS = 60;

export const CERT_NAME_MAX = 100;
export const CERT_DESCRIPTION_MAX = 2000;
export const CERT_REFERENCE_MAX = 100;
export const CERT_NOTES_MAX = 1000;
export const CERT_REVOKED_REASON_MAX = 1000;

// ---------------------------------------------------------------------------
// Post-shift feedback
// ---------------------------------------------------------------------------

export const SHIFT_FEEDBACK_MIN_RATING = 1;
export const SHIFT_FEEDBACK_MAX_RATING = 5;
export const SHIFT_FEEDBACK_COMMENT_MAX = 2000;

/**
 * Today's calendar date in club time, as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is tomorrow's
 * date in club time from 5pm PT onward — a date-input defaulted that way offers
 * a day the service rejects as being in the future. Client-safe: `$lib/config`
 * carries no server imports.
 */
export function clubToday(): string {
	// en-CA formats as YYYY-MM-DD, which is also what <input type="date"> wants.
	return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(new Date());
}

/** Minutes → display hours. 180 → "3 hrs", 90 → "1.5 hrs", 60 → "1 hr". */
export function formatVolunteerHours(minutes: number): string {
	const hours = minutes / 60;
	const rendered = Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, '');
	return `${rendered} ${hours === 1 ? 'hr' : 'hrs'}`;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export const suggestionCategories = [
	'website_tools',
	'gear_equipment',
	'events_programming',
	'the_space',
	'policy',
	'other'
] as const;

/** Editorial lifecycle — what staff have decided about the idea. */
export const suggestionStatuses = ['open', 'planned', 'in_progress', 'done', 'declined'] as const;

/**
 * Whether the suggestion is on the board at all — a separate axis from status,
 * so a public "Declined, here's why" can't be confused with a silent takedown.
 */
export const suggestionVisibilities = [
	'visible',
	'pending_review',
	'under_review',
	'hidden'
] as const;

export const SUGGESTION_TITLE_MAX = 120;
export const SUGGESTION_BODY_MAX = 2000;
export const SUGGESTION_RESPONSE_MAX = 2000;
export const SUGGESTION_NOTE_MAX = 500;

/**
 * How many distinct pending reporters it takes to pull a suggestion off the
 * board. One is a deliberate choice for a collective this size — reports here
 * are authenticated, attributable, and member-only — but it does mean any
 * member can hide any post until staff look at it. Raising this is the fix if
 * the board is ever abused, which is why it's a constant and not an `if`.
 */
export const SUGGESTION_FLAGS_TO_WITHHOLD = 1;

export const suggestionCategoryLabels: Record<(typeof suggestionCategories)[number], string> = {
	website_tools: 'Website & Tools',
	gear_equipment: 'Gear & Equipment',
	events_programming: 'Events & Programming',
	the_space: 'The Space',
	policy: 'Policy',
	other: 'Other'
};

/** Only `in_progress` needs help; the rest humanise fine on their own. */
export const suggestionStatusLabels: Record<(typeof suggestionStatuses)[number], string> = {
	open: 'Open',
	planned: 'Planned',
	in_progress: 'In progress',
	done: 'Done',
	declined: 'Declined'
};

export const suggestionVisibilityLabels: Record<(typeof suggestionVisibilities)[number], string> = {
	visible: 'On the board',
	pending_review: 'Waiting for review',
	under_review: 'Pulled for review',
	hidden: 'Hidden'
};

/** Select options, in declaration order. */
export const suggestionCategoryOptions = suggestionCategories.map((value) => ({
	value,
	label: suggestionCategoryLabels[value]
}));

export const suggestionStatusOptions = suggestionStatuses.map((value) => ({
	value,
	label: suggestionStatusLabels[value]
}));

// ---------------------------------------------------------------------------
// Entity vocabulary
// ---------------------------------------------------------------------------

/**
 * Every record type the app renders a reference to — a chip, a list row, a
 * card, or a detail page.
 *
 * This is the client-side half of the entity presentation system. It lives in
 * `config.ts` rather than beside the tables because `$lib/server` cannot be
 * imported from the browser, and every one of these values is read by a
 * `.svelte` file. The rendering half (icon, avatar shape) lives in
 * `$lib/components/shared/entity/registry.ts`, which carries Svelte icon
 * components and so cannot be imported by server code.
 *
 * Adding a value here without adding it to `entityKinds` fails
 * `registry.spec.ts`.
 */
export const entityTypes = [
	'member',
	'band',
	'event',
	'reservation',
	'suggestion',
	'thread',
	'flag',
	'campaign',
	'audience',
	'equipment',
	'loan',
	'shift',
	'role',
	'recurring',
	'help'
] as const;
export type EntityType = (typeof entityTypes)[number];

/**
 * What to call one, and what to call several.
 *
 * Domain-specific wording at a call site ("Waiting on DNS" rather than
 * "Pending") stays at the call site — the same rule `StatusBadge` follows.
 */
export const entityLabels: Record<EntityType, { one: string; many: string }> = {
	member: { one: 'Member', many: 'Members' },
	band: { one: 'Band', many: 'Bands' },
	event: { one: 'Event', many: 'Events' },
	reservation: { one: 'Reservation', many: 'Reservations' },
	suggestion: { one: 'Suggestion', many: 'Suggestions' },
	thread: { one: 'Conversation', many: 'Conversations' },
	flag: { one: 'Report', many: 'Reports' },
	campaign: { one: 'Campaign', many: 'Campaigns' },
	audience: { one: 'Audience', many: 'Audiences' },
	equipment: { one: 'Equipment', many: 'Equipment' },
	loan: { one: 'Loan', many: 'Loans' },
	shift: { one: 'Shift', many: 'Shifts' },
	role: { one: 'Volunteer role', many: 'Volunteer roles' },
	recurring: { one: 'Recurring series', many: 'Recurring series' },
	help: { one: 'Help article', many: 'Help articles' }
};

/**
 * `contentFlag.entityType` has its own vocabulary, older and narrower than
 * `entityTypes` — it names the *profile* rather than the record behind it.
 * This is the bridge, and it is what lets a flag link to what it reports
 * instead of re-deriving the route with a nested ternary.
 *
 * Keyed by string rather than `FlagEntityType` because that type lives in
 * `$lib/server/db/schema/flag` and cannot be imported here.
 * `registry.spec.ts` asserts every value of it is covered.
 */
export const flagEntityTypeToEntity: Record<string, EntityType> = {
	member_profile: 'member',
	band_profile: 'band',
	event: 'event',
	suggestion: 'suggestion',
	inbox_thread: 'thread'
};
