import { describe, it, expect } from 'vitest';
import { RESERVED_SLUGS, isReservedSlug } from './reserved-slugs';

/**
 * These assertions exist to stop a tidy-up, not to restate the constant.
 *
 * Reserving a word is only free while nothing holds it. Once a group or band
 * has taken one of these as its address, un-reserving is not a code change —
 * it is renaming somebody's live URL and breaking every link to it. So the
 * cost of accidentally deleting an entry here is paid much later and by
 * someone else, which is exactly the shape of change a test should guard.
 */
describe('reserved slugs', () => {
	/** docs/specs/groups-spec.md — the groups module cannot ship without these. */
	const GROUP_VOCABULARY = [
		'group',
		'groups',
		'club',
		'clubs',
		'class',
		'classes',
		'committee',
		'committees',
		'file',
		'files',
		'act',
		'acts'
	];

	/**
	 * Top-level route roots. Not a path collision — a band slug only ever appears
	 * nested — but this set gates subdomains, so an unreserved root means a band
	 * could answer on membership.corvmc.org.
	 */
	const ROUTE_ROOTS = [
		'about',
		'contact',
		'contribute',
		'local-resources',
		'membership',
		'programs',
		'show-tonight',
		'subscribe',
		'unsubscribe'
	];

	it.each(GROUP_VOCABULARY)('reserves the group word %s', (word) => {
		expect(isReservedSlug(word)).toBe(true);
	});

	it.each(ROUTE_ROOTS)('reserves the route root %s', (word) => {
		expect(isReservedSlug(word)).toBe(true);
	});

	it('matches case-insensitively, since slugs arrive from user input', () => {
		expect(isReservedSlug('Groups')).toBe(true);
		expect(isReservedSlug('COMMITTEE')).toBe(true);
	});

	it('leaves ordinary band names alone', () => {
		// The control. Without it every assertion above would pass just as
		// happily against a set that reserved everything.
		for (const slug of ['slowcatastrophe', 'the-charlie-horses', 'jean-shorts-jesus']) {
			expect(isReservedSlug(slug)).toBe(false);
		}
	});

	it('holds only lowercase entries, so the lookup can normalise one side', () => {
		// isReservedSlug lowercases its argument and nothing else. An uppercase
		// entry in the set would therefore be unreachable — reserved in appearance
		// and claimable in practice.
		const mixed = [...RESERVED_SLUGS].filter((s) => s !== s.toLowerCase());
		expect(mixed).toEqual([]);
	});
});
