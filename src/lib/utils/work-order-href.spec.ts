import { describe, it, expect } from 'vitest';
import { workOrderHref } from './work-order-href';

describe('workOrderHref', () => {
	it('sends a project work order to its task page', () => {
		expect(workOrderHref({ id: 'wo', projectId: 'p' })).toBe('/staff/projects/p/tasks/wo');
	});

	it('keeps a work order on no project on the shift page', () => {
		expect(workOrderHref({ id: 'wo', projectId: null })).toBe('/staff/volunteer/shifts/wo');
	});
});
