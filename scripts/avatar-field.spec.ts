import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Every form that uploads an avatar renders `AvatarField`, so a member, a band
 * and a group pick and preview theirs the same way (#3232). The upload posts
 * to an `/avatar` API route, which is how a form that picks one is found.
 */
const POSTS_AVATAR = /fetch\([^)]*\/avatar[`'"]/;

describe('avatar fields', () => {
	it('every form that uploads an avatar renders AvatarField', () => {
		const forms = sourceFiles(['src/**/*.svelte'], new Set()).filter((file) =>
			POSTS_AVATAR.test(readFileSync(file, 'utf8'))
		);
		expect(forms.length).toBeGreaterThan(0);
		expect(forms.filter((file) => !readFileSync(file, 'utf8').includes('<AvatarField'))).toEqual(
			[]
		);
	});
});
