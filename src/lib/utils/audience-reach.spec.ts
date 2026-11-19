import { describe, it, expect } from 'vitest';
import { audienceCount } from './audience-reach';

describe('audienceCount (#2772)', () => {
	it("counts the event audience as the chosen show's people", () => {
		expect(audienceCount({ systemKey: 'event-interest', subscriberCount: 0 }, 4)).toBe(4);
	});

	it('counts every other audience by its stored members', () => {
		expect(audienceCount({ systemKey: 'all-members', subscriberCount: 120 }, 4)).toBe(120);
		expect(audienceCount({ systemKey: null, subscriberCount: 30 }, 4)).toBe(30);
	});
});
