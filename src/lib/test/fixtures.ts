// Shared fixtures for isolated component tests and stories.
//
// These return plain objects matching the shapes that remote queries hand to
// components — they let a `.svelte.spec.ts` or `.stories.svelte` render a
// coupled component with no DB, auth, or server involved. Each factory takes an
// `overrides` partial so a test can pin only the fields it asserts on.

import type { EntityType } from '$lib/config';
import type { EntityRef } from '$lib/types/entity';

/** Matches the shape returned by `getMe` in `$lib/remote/layout.remote`. */
export function fakeUser(overrides: Partial<FakeUser> = {}): FakeUser {
	return {
		id: 'user-1',
		name: 'Jane Doe',
		email: 'jane@example.dev',
		image: null,
		...overrides
	};
}

export type FakeUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
};

/** Matches the band summary shape used across the member/band layouts. */
export function fakeBand(overrides: Partial<FakeBand> = {}): FakeBand {
	return {
		id: 'band-1',
		name: 'The Velvet Underground',
		slug: 'the-velvet-underground',
		avatarUrl: null,
		role: 'member',
		...overrides
	};
}

export type FakeBand = {
	id: string;
	name: string;
	slug: string;
	avatarUrl: string | null;
	role: string;
};

/**
 * A display reference for any entity type, with a plausible title per type so
 * a gallery story reads as real content rather than "member / band / event".
 *
 * `overrides` is loosely typed because `EntityRef` is a discriminated union —
 * the caller already picked the arm by passing `type`, and narrowing the
 * partial against it costs more in generics than it buys in a fixture.
 */
export function fakeRef<T extends EntityType>(
	type: T,
	overrides: Record<string, unknown> = {}
): EntityRef {
	const base = { id: `${type}-1`, type, ...sample[type] };
	return { ...base, ...overrides } as EntityRef;
}

const sample: Record<EntityType, { title: string; subtitle?: string; [k: string]: unknown }> = {
	member: { title: 'Jane Doe', subtitle: 'jane@example.dev', pronouns: 'she/her' },
	band: { title: 'The Velvet Underground', subtitle: '4 members', slug: 'the-velvet-underground' },
	event: { title: 'Basement Show: Loud Night', subtitle: 'Fri, Mar 14 · 8:00 PM' },
	reservation: { title: 'Mar 14, 7:00–9:00 PM', subtitle: '2 hours · Booked by Jane Doe' },
	suggestion: { title: 'Add a second drum kit', subtitle: 'Equipment · 12 votes' },
	thread: { title: 'Question about booking', subtitle: 'Jane Doe · 2 days ago' },
	flag: { title: 'The Velvet Underground', subtitle: 'Band profile · Misleading info' },
	campaign: { title: 'March newsletter', subtitle: 'Scheduled for Mar 1' },
	audience: { title: 'Sustaining members', subtitle: '212 subscribers' },
	equipment: { title: 'Fender Twin Reverb', subtitle: 'Amplifier · Good condition' },
	loan: { title: 'Fender Twin Reverb', subtitle: 'Out to Jane Doe · Due Mar 20' },
	shift: { title: 'Door · Loud Night', subtitle: 'Fri, Mar 14 · 7:30–11:00 PM' },
	role: { title: 'Sound engineer', subtitle: 'At shows · 6 volunteers' },
	recurring: { title: 'Every Tuesday, 6:00–8:00 PM', subtitle: 'Until Jun 30' },
	help: { title: 'How to book the practice space', subtitle: 'Getting started', slug: 'booking' }
};
