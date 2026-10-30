import { z } from 'zod';

/** ?month= query param for the mini-calendar: "YYYY-MM". */
export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

/** Gig guide query input: optional "YYYY-MM-DD" anchor date + page offset. */
export const gigGuideSchema = z.object({
	from: z
		.string()
		.regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
		.optional(),
	offset: z.number().int().min(0).default(0)
});

/** Page size for the gig guide list. */
export const GIG_GUIDE_PAGE_SIZE = 20;

/** Page size for the paged past-shows list on directory profiles. */
export const PAST_SHOWS_PAGE_SIZE = 20;

/** One event on the public calendar, shaped for the client. */
export interface CalendarEntry {
	id: string;
	title: string;
	startsAt: Date;
	/** Null when the gig has no recorded end — common on backfilled band shows. */
	endsAt: Date | null;
	source: string;
	/**
	 * 'published' or 'cancelled'. A cancelled show stays on the guide, marked,
	 * until its date passes — the cancellation IS the announcement, and the
	 * people who need it are the ones who already had the date.
	 */
	status: string;
	location: string | null;
	/** The structured venue's name, which the row prefers over `location`. */
	venueName?: string | null;
	bandName: string | null;
	bandSlug: string | null;
	posterUrl: string | null;
	ticketingEnabled: boolean;
	ticketPrice: number | null;
	externalTicketUrl: string | null;
}
