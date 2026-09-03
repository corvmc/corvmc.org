import { describe, it, expect } from 'vitest';
import { epkProgress, epkSections, type EpkCompletenessInput } from './epk-completeness';

/**
 * The ladder is configuration, and configuration rots silently — the exact
 * failure mode `social-prior-art.md` warns about and that `feature-flags.spec.ts`
 * already guards for flags. So this asserts the list **both ways**: an empty act
 * finishes nothing, and a complete one finishes everything. A rung whose
 * predicate is wrong fails one direction or the other.
 */

const EMPTY: EpkCompletenessInput = {
	slug: 'the-velvet-underground',
	name: 'The Velvet Underground',
	avatarKey: null,
	tagline: null,
	bio: null,
	hometown: null,
	foundedYear: null,
	genres: [],
	links: [],
	membersWithPosition: 0,
	upcomingShows: 0,
	epk: null,
	pressPhotos: 0,
	tier: 'free',
	premiumAvailable: false
};

const COMPLETE: EpkCompletenessInput = {
	...EMPTY,
	avatarKey: 'avatar.jpg',
	tagline: 'Loud',
	bio: 'A band from Corvallis.',
	hometown: 'Corvallis',
	foundedYear: '1965',
	genres: ['rock'],
	links: [{ label: 'Bandcamp', url: 'https://act.bandcamp.com/album/foo' }],
	membersWithPosition: 3,
	upcomingShows: 1,
	pressPhotos: 1,
	epk: {
		bookingContact: { name: 'Bea', email: 'bea@example.com' },
		backline: [{ instrument: 'Bass cab', details: 'Ampeg', provided: false }],
		pressQuotes: [{ quote: 'Loud and good', publication: 'The Gazette' }]
	}
};

describe('epkSections', () => {
	it('finishes nothing for an act that has written nothing', () => {
		const done = epkSections(EMPTY).filter((s) => s.done);
		// The act's *name* always exists, but the identity rung needs a logo too,
		// so a brand-new act genuinely starts at zero.
		expect(done).toEqual([]);
	});

	it('finishes everything for an act that has written everything', () => {
		const unfinished = epkSections(COMPLETE)
			.filter((s) => !s.done)
			.map((s) => s.key);
		expect(unfinished).toEqual([]);
	});

	it('hides the premium rungs when there is nothing to sell', () => {
		// `bandPremium` is off in production. Three locked rungs advertising a
		// product nobody can buy is worse than a ladder that simply ends.
		expect(epkSections({ ...EMPTY, premiumAvailable: false }).every((s) => s.tier === 'free')).toBe(
			true
		);
		expect(
			epkSections({ ...EMPTY, premiumAvailable: true }).filter((s) => s.tier === 'premium')
		).toHaveLength(3);
	});

	it('never marks a premium rung done for a free act', () => {
		const premium = epkSections({
			...COMPLETE,
			premiumAvailable: true,
			pressPhotos: 8,
			epk: { ...COMPLETE.epk, videos: [{ url: 'https://youtu.be/abc' }] }
		}).filter((s) => s.tier === 'premium');
		// Same data, free tier: having eight photos and a video row does not buy
		// the gallery or the video section.
		expect(premium.every((s) => !s.done)).toBe(true);
	});

	it('marks the premium rungs done for a premium act that used them', () => {
		const premium = epkSections({
			...COMPLETE,
			tier: 'premium',
			premiumAvailable: true,
			pressPhotos: 8,
			epk: { ...COMPLETE.epk, videos: [{ url: 'https://youtu.be/abc' }] }
		}).filter((s) => s.tier === 'premium');
		expect(premium.every((s) => s.done)).toBe(true);
	});

	it('gives every rung a distinct key and a place to go', () => {
		const sections = epkSections({ ...EMPTY, premiumAvailable: true });
		expect(new Set(sections.map((s) => s.key)).size).toBe(sections.length);
		expect(sections.every((s) => s.route.startsWith('/band/[slug]'))).toBe(true);
		expect(sections.every((s) => s.hint.length > 0)).toBe(true);
	});
});

describe('individual rungs', () => {
	it('counts a hometown or a founding year, not both', () => {
		const only = (patch: Partial<EpkCompletenessInput>) =>
			epkSections({ ...EMPTY, ...patch }).find((s) => s.key === 'origin')!.done;
		expect(only({ hometown: 'Corvallis' })).toBe(true);
		expect(only({ foundedYear: '1965' })).toBe(true);
		expect(only({})).toBe(false);
	});

	it('wants a link it can actually play, not just any link', () => {
		const music = (links: EpkCompletenessInput['links']) =>
			epkSections({ ...EMPTY, links }).find((s) => s.key === 'music')!.done;
		expect(music([{ label: 'Facebook', url: 'https://facebook.com/act' }])).toBe(false);
		expect(music([{ label: 'BC', url: 'https://act.bandcamp.com/album/foo' }])).toBe(true);
	});

	it('takes press quotes or highlights, either one', () => {
		const press = (epk: EpkCompletenessInput['epk']) =>
			epkSections({ ...EMPTY, epk }).find((s) => s.key === 'press')!.done;
		expect(press({ achievements: ['Opened for someone'] })).toBe(true);
		expect(press({ pressQuotes: [{ quote: 'Good', publication: 'Paper' }] })).toBe(true);
		expect(press({ pressQuotes: [], achievements: [] })).toBe(false);
	});

	it('treats whitespace as unwritten', () => {
		const tagline = epkSections({ ...EMPTY, tagline: '   ' }).find((s) => s.key === 'tagline')!;
		expect(tagline.done).toBe(false);
	});

	it('needs an email for the booking rung, not just a name', () => {
		const booking = (epk: EpkCompletenessInput['epk']) =>
			epkSections({ ...EMPTY, epk }).find((s) => s.key === 'booking')!.done;
		expect(booking({ bookingContact: { name: 'Bea', email: '' } })).toBe(false);
		expect(booking({ bookingContact: { name: 'Bea', email: 'bea@example.com' } })).toBe(true);
	});

	it('says the shows rung fills itself', () => {
		// The hardest item on any EPK checklist, generated from the gig guide the
		// act already maintains. If this stops saying so, the band is being asked
		// to do work that is already done.
		const shows = epkSections(EMPTY).find((s) => s.key === 'shows')!;
		expect(shows.hint).toMatch(/automatic/i);
	});
});

describe('epkProgress', () => {
	it('scores the free rungs only', () => {
		const p = epkProgress({ ...EMPTY, premiumAvailable: true });
		expect(p.total).toBe(12);
		expect(p.done).toBe(0);
		expect(p.sections.length).toBe(15);
	});

	it('names the first thing left to do', () => {
		expect(epkProgress(EMPTY).next?.key).toBe('identity');
		expect(epkProgress({ ...COMPLETE, epk: null }).next?.key).toBe('press');
	});

	it('has no next step once the free ladder is finished', () => {
		const p = epkProgress(COMPLETE);
		expect(p.done).toBe(p.total);
		expect(p.next).toBeNull();
	});
});
