import { describe, it, expect } from 'vitest';
import {
	entityKinds,
	statusTone,
	toneFor,
	entityGlyph,
	hasSubtype,
	entityIcon,
	ordinaryStatuses,
	isNoteworthyStatus
} from './registry';
import { entityTypes, entityLabels, flagEntityTypeToEntity, type EntityType } from '$lib/config';
import { flagEntityTypes } from '$lib/server/db/schema/flag';
import { eventSources } from '$lib/server/db/schema/event';
import { bookerTypes } from '$lib/server/db/schema/reservation';
import { fakeRef } from '$lib/test/fixtures';
import { variants, badgeClass } from '../StatusBadge.svelte';

/**
 * The entity vocabulary is split across three files by necessity — values in
 * `config.ts` because the browser needs them, icons in `registry.ts` because
 * server code cannot import Svelte components, routes in `entity-href.ts`
 * because that has to stay pure. Nothing in the type system holds the three
 * together, so this does.
 *
 * Same idea as `StatusBadge.spec.ts`: adding an entity type and forgetting half
 * its wiring should fail here rather than render a wrong glyph in production.
 */
describe('entity registry', () => {
	it('draws every entity type', () => {
		const missing = entityTypes.filter((t) => !(t in entityKinds));
		expect(missing, `add these to entityKinds: ${missing.join(', ')}`).toEqual([]);
	});

	it('names every entity type', () => {
		const missing = entityTypes.filter((t) => !(t in entityLabels));
		expect(missing, `add these to entityLabels: ${missing.join(', ')}`).toEqual([]);
	});

	it('has no entries for types that no longer exist', () => {
		const known = new Set<string>(entityTypes);
		const stale = [...Object.keys(entityKinds), ...Object.keys(entityLabels)].filter(
			(k) => !known.has(k)
		);
		expect(stale, `remove these, or add them to entityTypes: ${stale.join(', ')}`).toEqual([]);
	});

	/**
	 * A chip is a glyph and a name. Two types sharing a glyph makes the glyph
	 * say nothing, which is the one failure the smallest tier cannot absorb.
	 */
	it('gives every type its own icon', () => {
		const byIcon = new Map<unknown, EntityType[]>();
		for (const type of entityTypes) {
			const icon = entityKinds[type].icon;
			byIcon.set(icon, [...(byIcon.get(icon) ?? []), type]);
		}
		const collisions = [...byIcon.values()].filter((types) => types.length > 1);
		expect(collisions, `these types share an icon: ${JSON.stringify(collisions)}`).toEqual([]);
	});

	/** The directory-wide convention, stated in prose in ui-patterns. */
	it('keeps member avatars round and band avatars square', () => {
		expect(entityKinds.member.shape).toBe('round');
		expect(entityKinds.band.shape).toBe('square');
	});

	/**
	 * A gig poster is portrait, always. Cropping one into a landscape strip
	 * throws away the half that carries the lineup, so the event type gets its
	 * own shape rather than borrowing the square avatar box.
	 */
	it('gives events a portrait poster box', () => {
		expect(entityKinds.event.shape).toBe('poster');
	});

	/**
	 * `contentFlag.entityType` is an older, narrower vocabulary. Before the
	 * bridge existed, `staff/flags/[id]` carried a hand-written label map and a
	 * five-deep nested ternary to turn one into a URL.
	 */
	it('maps every flag entity type onto an entity type', () => {
		const unmapped = flagEntityTypes.filter((t) => !(t in flagEntityTypeToEntity));
		expect(unmapped, `add these to flagEntityTypeToEntity: ${unmapped.join(', ')}`).toEqual([]);

		const known = new Set<string>(entityTypes);
		const dangling = Object.entries(flagEntityTypeToEntity).filter(([, v]) => !known.has(v));
		expect(dangling, `these point at unknown entity types: ${JSON.stringify(dangling)}`).toEqual(
			[]
		);
	});

	/**
	 * A card carries status as an outline round its media rather than a labelled
	 * badge. The ring colours are literal strings because Tailwind only emits
	 * classes it can see, so a new `variants` colour silently loses its ring
	 * unless this catches it.
	 */
	it('has a tone for every status colour StatusBadge uses', () => {
		const colours = [...new Set(Object.values(variants).map((v) => v.color))];
		const missing = colours.filter((c) => !(c in statusTone));
		expect(missing, `add these to statusTone: ${missing.join(', ')}`).toEqual([]);
	});

	/**
	 * Ring, fill and border come from one record so a chip cannot end up with an
	 * error region and a neutral outline — two decisions that read as a mistake.
	 */
	it('gives a status the same tone on every surface', () => {
		const tone = toneFor('no_show');
		expect(tone).toEqual({
			ring: 'ring-error',
			fill: 'bg-error text-error-content',
			border: 'border-error',
			borderHover: 'hover:border-error/60'
		});
	});

	it('falls back to neutral rather than nothing for an unmapped status', () => {
		expect(toneFor('some_new_status')?.border).toBe('border-neutral');
		expect(toneFor(null)).toBeNull();
	});

	/**
	 * Subtypes are exception-only: the ordinary case is deliberately absent so
	 * it gets no marker. That makes "is it missing on purpose?" a real question,
	 * so each vocabulary names its unmarked value explicitly here.
	 */
	describe('subtypes', () => {
		it.each([
			['event', eventSources, ['cmc']],
			['reservation', bookerTypes, ['user']]
		] as const)('covers every %s value except the ordinary one', (type, vocabulary, unmarked) => {
			const declared = entityKinds[type].subtypes ?? {};
			const expected = vocabulary.filter((v) => !unmarked.includes(v as never)).sort();
			expect(Object.keys(declared).sort()).toEqual([...expected]);
		});

		it('gives every subtype its own glyph within its type', () => {
			for (const type of entityTypes) {
				const subtypes = entityKinds[type].subtypes;
				if (!subtypes) continue;
				// Against each other *and* against the type's own default, so a
				// marked record never looks identical to an unmarked one.
				const icons = [entityKinds[type].icon, ...Object.values(subtypes).map((s) => s.icon)];
				expect(new Set(icons).size, `${type} reuses a glyph across its subtypes`).toBe(
					icons.length
				);
			}
		});

		it('falls back to the type glyph for an unmarked or unknown subtype', () => {
			const plain = entityGlyph(fakeRef('member', { subtype: null }));
			expect(plain.icon).toBe(entityKinds.member.icon);
			expect(hasSubtype(fakeRef('member', { subtype: null }))).toBe(false);
			// An unrecognised value must not blank the glyph.
			expect(entityGlyph(fakeRef('member', { subtype: 'nonsense' })).icon).toBe(
				entityKinds.member.icon
			);
			expect(hasSubtype(fakeRef('member', { subtype: 'nonsense' }))).toBe(false);
		});

		it('resolves a marked record to its own glyph', () => {
			const sustaining = entityGlyph(fakeRef('member', { subtype: 'sustaining' }));
			expect(sustaining.icon).toBe(entityKinds.member.subtypes!.sustaining.icon);
			expect(sustaining.label).toBe('Sustaining member');
		});
	});

	/**
	 * A status callout is for exceptions. Once every healthy record carries one,
	 * the record that actually needs attention stops standing out — which is the
	 * only reason the mark exists.
	 */
	describe('noteworthy statuses', () => {
		it('treats every "everything is fine" status as ordinary', () => {
			const success = Object.entries(badgeClass)
				.filter(([, cls]) => cls === 'badge-success')
				.map(([status]) => status);
			const shouting = success.filter((s) => !ordinaryStatuses.has(s));
			expect(
				shouting,
				`these read as success but would still be called out: ${shouting.join(', ')}`
			).toEqual([]);
		});

		it('marks the states that need attention', () => {
			for (const status of ['cancelled', 'no_show', 'draft', 'expired', 'blocked', 'pending']) {
				expect(isNoteworthyStatus(status), `${status} should be marked`).toBe(true);
			}
		});

		it('says nothing about a record in its expected state', () => {
			for (const status of ['active', 'published', 'confirmed', 'completed']) {
				expect(isNoteworthyStatus(status), `${status} should be quiet`).toBe(false);
			}
		});

		it('errs toward marking a status it has never seen', () => {
			expect(isNoteworthyStatus('some_new_status')).toBe(true);
			expect(isNoteworthyStatus(null)).toBe(false);
		});

		it('leaves no ordinary status that StatusBadge cannot draw', () => {
			const undrawable = [...ordinaryStatuses].filter((s) => !(s in variants));
			expect(undrawable, `not in StatusBadge variants: ${undrawable.join(', ')}`).toEqual([]);
		});
	});

	/**
	 * Identity vs qualifier. A subtype glyph only ever appears next to a name
	 * that already says what the record is, which is what makes it safe for two
	 * *different* types to share one — a band's show and a band-booked
	 * reservation both take the music note. An identity glyph has no such
	 * context, so it must never be a subtype's.
	 */
	describe('identity vs qualifier glyphs', () => {
		it('never lets a subtype stand in as identity', () => {
			const reservation = fakeRef('reservation', { subtype: 'band' });
			expect(entityIcon(reservation).icon).toBe(entityKinds.reservation.icon);
			// ...even though the qualifier for the same ref is the band glyph.
			expect(entityGlyph(reservation).icon).toBe(entityKinds.reservation.subtypes!.band.icon);
		});

		it('always names the type, whatever the subtype', () => {
			expect(entityIcon(fakeRef('member', { subtype: 'sustaining' })).label).toBe('Member');
			expect(entityIcon(fakeRef('event', { subtype: 'community' })).label).toBe('Event');
		});

		/**
		 * The identity glyphs are the ones that must stay distinct across the
		 * whole registry, because they are what a chip or a card leans on alone.
		 */
		it('keeps every identity glyph unique across types', () => {
			const icons = entityTypes.map((t) => entityIcon(fakeRef(t)).icon);
			expect(new Set(icons).size).toBe(icons.length);
		});
	});
});
