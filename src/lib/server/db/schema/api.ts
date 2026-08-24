import type { Credits, SubscriptionInfo, CommunityStats } from './finance';
import type { User } from './authentication';
import type { Band, BandMember } from './band';
import type { Reservation } from './reservation';
import type { Event } from './event';
import type { EquipmentLoan } from './equipment';
import type { Ticket } from './ticket';
import type { Audience } from './marketing';
import type { MemberRef } from '$lib/types/entity';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export interface Pagination {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
}

/**
 * @deprecated Use `MemberRef` from `$lib/types/entity`, which the entity tiers
 * take directly and `toMemberRef` produces. This shape existed for `MemberLink`,
 * which asked each call site to work out the role/subscription precedence for
 * itself; the alias remains only so an out-of-tree reference still compiles.
 */
export type MemberSummary = MemberRef;

// ---------------------------------------------------------------------------
// Auth & Layout
// ---------------------------------------------------------------------------

export interface AuthMeResponse {
	user: Pick<User, 'id' | 'name' | 'email' | 'image'> | null;
}

export interface MemberLayoutResponse {
	user: Pick<User, 'id' | 'name' | 'email'>;
	userBands: (Pick<Band, 'id' | 'name' | 'slug' | 'avatarKey'> & { role: string })[];
	isStaff: boolean;
}

export interface StaffLayoutResponse {
	user: Pick<User, 'id' | 'name' | 'email'>;
	userBands: Pick<Band, 'id' | 'name' | 'slug'>[];
}

export interface BandLayoutResponse {
	band: Pick<Band, 'id' | 'name' | 'slug' | 'bio' | 'ownerId' | 'avatarKey' | 'createdAt'> & {
		memberCount: number;
	};
	userRole: string;
	isStaff: boolean;
	userBands: Pick<Band, 'id' | 'name' | 'slug'>[];
	user: Pick<User, 'id' | 'name' | 'email'> | null;
}

// ---------------------------------------------------------------------------
// Member pages
// ---------------------------------------------------------------------------

export interface DashboardResponse {
	weekReservations: (Pick<
		Reservation,
		'id' | 'bookerType' | 'bookerId' | 'status' | 'startsAt' | 'endsAt' | 'notes'
	> & {
		bandName: string | null;
	})[];
	upcomingEvents: (Pick<Event, 'id' | 'title' | 'startsAt' | 'endsAt' | 'doorsAt'> & {
		posterUrl: string | null;
	})[];
	credits: Credits;
	subscription: SubscriptionInfo | null;
	allocatedThisMonth: number;
	usedThisMonth: number;
	pendingInviteCount: number;
}

export interface AccountResponse {
	user: Pick<User, 'id' | 'name' | 'email' | 'pronouns' | 'phone'>;
	isStaff: boolean;
}

export interface MemberBandsResponse {
	pending: (Pick<Band, 'id' | 'name' | 'slug' | 'avatarKey'> &
		Pick<BandMember, 'role' | 'status'> & { memberCount: number })[];
	active: (Pick<Band, 'id' | 'name' | 'slug' | 'avatarKey'> &
		Pick<BandMember, 'role' | 'status'> & { memberCount: number })[];
}

export type MemberReservation = Pick<
	Reservation,
	| 'id'
	| 'bookerType'
	| 'bookerId'
	| 'status'
	| 'startsAt'
	| 'endsAt'
	| 'notes'
	| 'recurringSeriesId'
> & {
	paidAt: Date | null;
	refundedAt: Date | null;
	paidWithCredits: boolean;
	waitlistNotifiedAt: Date | null;
	waitlistExpiresAt: Date | null;
};

export interface MemberReservationsResponse {
	upcoming: MemberReservation[];
	all: MemberReservation[];
	recurringSeries: {
		id: string;
		frequencyLabel: string;
		monthlyMode: 'weekday' | 'monthday' | null;
		bookerType: string;
		startsAt: Date;
		endsAt: Date;
		createdAt: Date;
		seriesEndsAt: Date | null;
	}[];
}

export interface ReservationPayResponse {
	reservation: Pick<Reservation, 'id' | 'startsAt' | 'endsAt' | 'notes'>;
	durationHours: number;
	totalCents: number;
	hourlyRateCents: number;
	freeHoursBalance: number;
}

export interface MemberTicketsResponse {
	tickets: (Pick<
		Ticket,
		'id' | 'eventId' | 'code' | 'status' | 'attendeeName' | 'checkedInAt' | 'createdAt'
	> & {
		event: Pick<Event, 'title' | 'startsAt' | 'endsAt'> | null;
	})[];
}

export interface MemberEquipmentLoansResponse {
	active: (EquipmentLoan & { equipmentName: string | null; isOverdue: boolean })[];
	past: (EquipmentLoan & { equipmentName: string | null; isOverdue: boolean })[];
}

export interface MembershipResponse {
	subscription: SubscriptionInfo | null;
	credits: Credits;
	billingPortalUrl: string | null;
	communityStats: CommunityStats;
	allocatedThisMonth: number;
	usedThisMonth: number;
	contributionUnitCents: number;
	feeSchedule: { perUnit: number };
}

// ---------------------------------------------------------------------------
// Band pages
// ---------------------------------------------------------------------------

export interface BandReservationsResponse {
	upcoming: (Pick<Reservation, 'id' | 'status' | 'startsAt' | 'endsAt' | 'notes'> & {
		bookedByName: string | null;
	})[];
	past: (Pick<Reservation, 'id' | 'status' | 'startsAt' | 'endsAt' | 'notes'> & {
		bookedByName: string | null;
	})[];
}

// ---------------------------------------------------------------------------
// Staff pages
// ---------------------------------------------------------------------------

export interface StaffCheckInResponse {
	event: Pick<Event, 'id' | 'title' | 'startsAt' | 'ticketQuantity'>;
	tickets: Pick<
		Ticket,
		'id' | 'attendeeName' | 'attendeeEmail' | 'code' | 'status' | 'checkedInAt'
	>[];
	stats: { sold: number; checkedIn: number };
}

export interface StaffReservationDetailResponse {
	reservation: Pick<
		Reservation,
		| 'id'
		| 'status'
		| 'startsAt'
		| 'endsAt'
		| 'bookerType'
		| 'bookerId'
		| 'notes'
		| 'cancellationReason'
		| 'stripePaymentRecordId'
		| 'createdByUserId'
		| 'createdAt'
	> & {
		memberName: string;
		memberEmail: string;
		memberPhone: string | null;
		memberPronouns: string | null;
		memberImage: string | null;
	};
	sameDayReservations: (Pick<Reservation, 'id' | 'bookerType' | 'startsAt' | 'endsAt'> & {
		memberName: string;
	})[];
	isLastOfDay: boolean;
	prevId: string | null;
	nextId: string | null;
	isFirstReservation: boolean;
	hourlyRateCents: number;
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

export interface DirectoryResponse {
	members: (Pick<User, 'id' | 'name' | 'pronouns' | 'image' | 'tagline' | 'lookingForBand'> & {
		instruments: string[];
		genres: string[];
		memberSince: string;
		bands: Pick<Band, 'name' | 'slug'>[];
	})[];
	bands: (Pick<Band, 'id' | 'name' | 'slug' | 'bio' | 'tagline' | 'lookingForMembers'> & {
		avatarUrl: string | null;
		memberCount: number;
		genres: string[];
	})[];
}

export interface DirectoryBandResponse {
	band: Pick<
		Band,
		| 'id'
		| 'name'
		| 'slug'
		| 'bio'
		| 'tagline'
		| 'createdAt'
		| 'lookingForMembers'
		| 'directoryContact'
		| 'links'
	> & {
		avatarUrl: string | null;
		memberCount: number;
		genres: string[];
	};
	members: (Pick<BandMember, 'id' | 'role' | 'position'> & {
		userName: string;
		userImage: string | null;
	})[];
}

export interface DirectoryMemberResponse {
	member: Pick<
		User,
		| 'id'
		| 'name'
		| 'pronouns'
		| 'image'
		| 'bio'
		| 'tagline'
		| 'lookingForBand'
		| 'directoryContact'
		| 'links'
	> & {
		instruments: string[];
		genres: string[];
	};
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventsResponse {
	events: (Pick<
		Event,
		| 'id'
		| 'title'
		| 'description'
		| 'startsAt'
		| 'endsAt'
		| 'doorsAt'
		| 'tags'
		| 'ticketingEnabled'
		| 'ticketPrice'
	> & {
		posterUrl: string | null;
	})[];
}

// ---------------------------------------------------------------------------
// Marketing
// ---------------------------------------------------------------------------

export interface AudienceDetailResponse {
	audience: Pick<Audience, 'id' | 'name' | 'slug' | 'description'>;
	isSubscribed: boolean;
}

export interface UnsubscribeResponse {
	valid: boolean;
	audienceName: string | null;
}
