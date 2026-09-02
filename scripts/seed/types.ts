export interface SeedRole {
	id: number;
	name: string;
}

export interface SeedUser {
	id: string;
	name: string;
	email: string;
}

export interface SeedEvent {
	id: string;
	status: string;
	startsAt: Date;
	endsAt: Date | null;
}

/** Matches the `reservation.hourlyRateCents` site-config default. */
export const HOURLY_RATE_CENTS = 1500;

export interface SeedReservation {
	id: string;
	createdByUserId: string;
	startsAt: Date;
	endsAt: Date;
	status: string;
}
