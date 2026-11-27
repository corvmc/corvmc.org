import { describe, it, expect } from 'vitest';
import { enquiryDestination } from './enquiry-destination';

describe('enquiryDestination', () => {
	it('sends to the booking contact when there is one', () => {
		expect(
			enquiryDestination(
				{ bookingContact: { name: 'Bea', email: 'bea@example.com' } },
				{ email: 'band@example.com' }
			)
		).toEqual({ email: 'bea@example.com', source: 'booking' });
	});

	it('falls back to the profile contact email', () => {
		expect(
			enquiryDestination(
				{ bookingContact: { name: 'Bea', email: '  ' } },
				{ email: 'band@example.com' }
			)
		).toEqual({ email: 'band@example.com', source: 'profile' });
	});

	it('names no address when neither is set', () => {
		expect(enquiryDestination(null, null)).toBeNull();
		expect(enquiryDestination(undefined, { email: 42 })).toBeNull();
	});
});
