import { describe, it, expect } from 'vitest';
import { workOrderHref, workOrderPathname } from './work-order-href';

describe('workOrderHref', () => {
	it('sends every work order to its task page, in a project or not', () => {
		expect(workOrderHref({ id: 'wo' })).toBe('/staff/tasks/wo');
		expect(workOrderPathname({ id: 'wo' })).toBe('staff/tasks/wo');
	});
});
