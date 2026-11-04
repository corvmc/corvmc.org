import { describe, expect, it } from 'vitest';
import { load as oldIndex } from './+page';
import { load as oldDetail } from './[id]/+page';
import { load as dutyIndex } from '../volunteer/duty-lists/+page';
import { load as dutyDetail } from '../volunteer/duty-lists/[id]/+page';

const event = {
	params: { id: 'abc' },
	url: new URL('http://x/'),
	route: { id: '/staff' },
	request: new Request('http://x/')
} as never;

describe('every old templates URL lands in one hop', () => {
	it.each([
		['/staff/project-templates', oldIndex, '/staff/projects/templates'],
		['/staff/project-templates/abc', oldDetail, '/staff/projects/templates/abc'],
		['/staff/volunteer/duty-lists', dutyIndex, '/staff/projects/templates'],
		['/staff/volunteer/duty-lists/abc', dutyDetail, '/staff/projects/templates/abc']
	])('%s', async (_from, load, location) => {
		// Async whichever way the file writes it: the build wraps every load.
		await expect((async () => (load as (e: never) => unknown)(event))()).rejects.toMatchObject({
			status: 308,
			location
		});
	});
});
