import { describe, it, expect } from 'vitest';
import { mapMemberFlags } from './legacy-flags';

describe('mapMemberFlags', () => {
	it('defaults every flag to false for empty input', () => {
		expect(mapMemberFlags([])).toEqual({
			lookingForBand: false,
			availableForHire: false,
			teachesLessons: false,
			openToCollaboration: false
		});
	});

	it('maps each legacy flag name to its new field', () => {
		expect(
			mapMemberFlags([
				'looking_for_band',
				'available_for_hire',
				'music_teacher',
				'open_to_collaboration'
			])
		).toEqual({
			lookingForBand: true,
			availableForHire: true,
			teachesLessons: true,
			openToCollaboration: true
		});
	});

	it('maps the legacy music_teacher flag to teachesLessons', () => {
		const flags = mapMemberFlags(['music_teacher']);
		expect(flags.teachesLessons).toBe(true);
		expect(flags.lookingForBand).toBe(false);
	});

	it('sets only the flags present, leaving others false', () => {
		expect(mapMemberFlags(['open_to_collaboration', 'looking_for_band'])).toEqual({
			lookingForBand: true,
			availableForHire: false,
			teachesLessons: false,
			openToCollaboration: true
		});
	});

	it('ignores unknown flag names', () => {
		expect(mapMemberFlags(['some_future_flag', 'available_for_hire'])).toEqual({
			lookingForBand: false,
			availableForHire: true,
			teachesLessons: false,
			openToCollaboration: false
		});
	});

	it('accepts a Set as input', () => {
		expect(mapMemberFlags(new Set(['looking_for_band'])).lookingForBand).toBe(true);
	});
});
