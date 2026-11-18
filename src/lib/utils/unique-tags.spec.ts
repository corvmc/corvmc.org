import { describe, expect, it } from 'vitest';
import { parseTagList, uniqueTags } from './unique-tags';

describe('uniqueTags', () => {
	it('drops a repeat across lists, case-insensitively, keeping the first spelling', () => {
		expect(uniqueTags(['Vocals', 'bass'], ['vocals', ' Bass ', 'jazz'])).toEqual([
			'Vocals',
			'bass',
			'jazz'
		]);
	});

	it('skips blanks and missing values', () => {
		expect(uniqueTags(['', ' ', null, undefined, 'rock'])).toEqual(['rock']);
	});
});

describe('parseTagList', () => {
	it('splits on commas and drops repeats', () => {
		expect(parseTagList('rock, Rock,all-ages,, rock')).toEqual(['rock', 'all-ages']);
	});

	it('is empty for no tags', () => {
		expect(parseTagList(null)).toEqual([]);
		expect(parseTagList('')).toEqual([]);
	});
});
