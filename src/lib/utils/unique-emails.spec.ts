import { describe, it, expect } from 'vitest';
import { uniqueEmails } from './unique-emails';

describe('uniqueEmails', () => {
	it('keeps the first spelling of each address and drops blanks', () => {
		expect(uniqueEmails([' A@x.com', null, 'a@X.com', '', 'b@x.com', undefined])).toEqual([
			'A@x.com',
			'b@x.com'
		]);
	});
});
