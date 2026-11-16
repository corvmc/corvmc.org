/** The listing's two place fields; `location` is the venue name. */
export interface ListingPlace {
	location: string | null;
	address?: string | null;
}

/**
 * Venue and address as one line, for consumers with a single location field
 * (iCalendar LOCATION, the RSS body, calendar links). A row older than the
 * address column carries its whole line in `location` and comes back as is.
 */
export function placeLine({ location, address }: ListingPlace): string | null {
	const parts = [location?.trim(), address?.trim()].filter((p): p is string => Boolean(p));
	return parts.length ? parts.join(', ') : null;
}

/** A map search for the address, with the venue name to disambiguate it. */
export function mapUrl(place: ListingPlace): string | null {
	if (!place.address?.trim()) return null;
	const query = placeLine(place) as string;
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** A venue row's address as one line: "361 SW Madison Ave, Corvallis, OR 97333". */
export function venueAddress(v: {
	address1: string | null;
	city: string | null;
	state: string | null;
	postalCode: string | null;
}): string | null {
	const region = [v.state, v.postalCode].filter(Boolean).join(' ');
	const parts = [v.address1, v.city, region].filter(Boolean);
	return parts.length ? parts.join(', ') : null;
}
