import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';
import VisibilityField from './VisibilityField.svelte';

const field = {
	as: (type: string, value?: unknown) => ({ type, name: 'visibility', value }),
	issues: () => null
} as unknown as RemoteFormField<RemoteFormFieldValue>;

/** "Group members" means the owning group's, so a listing no group owns is not offered it. */
describe('VisibilityField', () => {
	it.each([
		[false, ['public', 'members']],
		[true, ['public', 'members', 'group']]
	])('with a group %s offers %j', async (hasGroup, values) => {
		await render(VisibilityField, { field, value: 'public', hasGroup });
		const select = page.getByRole('combobox').element() as HTMLSelectElement;
		expect([...select.options].map((o) => o.value)).toEqual(values);
	});
});
