/**
 * The one place a band's EPK is split by audience.
 *
 * `band_site.epk` mixes two things a band writes for two different readers: the
 * marketing half anyone may see, and the advance half only a venue the band
 * chose to email should see — named people, their phone numbers, and what the
 * act needs on stage.
 *
 * Every read path goes through one of these two functions and **nothing reads
 * `epk` raw**. That is the whole boundary: if a contact role ever appears on a
 * public page it will be because a caller skipped this module, so there is
 * exactly one file to audit. `press-kit.spec.ts` asserts both directions.
 *
 * These are projections, not guards — they decide *what* a caller may show, not
 * *whether* they may. Authorization stays in the remote function above them.
 */
import type { BandEpk, FullPressKit, PublicPressKit } from '$lib/types/band-page';

/**
 * What `/directory/bands/{slug}` and its print stylesheet render.
 *
 * The absent fields are the point. There is deliberately **no contact of any
 * kind** here, not even an email: a stranger reaches the band through the
 * Turnstile-backed form, so no address is published for a scraper to collect.
 * Nor is there a rider, stage plot or backline — a venue gets those by asking,
 * which is also how the band finds out somebody is interested.
 */
export function publicPressKit(epk: BandEpk | null | undefined): PublicPressKit {
	return {
		pressQuotes: epk?.pressQuotes ?? [],
		achievements: epk?.achievements ?? [],
		videos: epk?.videos ?? []
	};
}

/**
 * What goes in the downloadable package, and what a premium microsite may
 * render behind its own gate.
 *
 * Built by spreading the public projection rather than by copying its fields,
 * so a field added to `PublicPressKit` cannot be forgotten here — the compiler
 * catches the reverse direction, and the spec catches this one.
 */
export function fullPressKit(epk: BandEpk | null | undefined): FullPressKit {
	return {
		...publicPressKit(epk),
		...(epk?.bookingContact ? { bookingContact: epk.bookingContact } : {}),
		...(epk?.managementContact ? { managementContact: epk.managementContact } : {}),
		...(epk?.prContact ? { prContact: epk.prContact } : {}),
		...(epk?.technicalRiderKey ? { technicalRiderKey: epk.technicalRiderKey } : {}),
		...(epk?.stagePlotKey ? { stagePlotKey: epk.stagePlotKey } : {}),
		backline: epk?.backline ?? []
	};
}

/** Whether the band has given a venue any way to reach a named person. */
export function hasBookingContact(epk: BandEpk | null | undefined): boolean {
	return !!epk?.bookingContact?.email;
}
