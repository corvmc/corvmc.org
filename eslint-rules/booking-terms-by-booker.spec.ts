import rule from './booking-terms-by-booker.js';
import { tsRuleTester } from './rule-tester.js';

tsRuleTester().run('booking-terms-by-booker', rule as never, {
	valid: [
		{ code: "const { minDurationHours } = termsFor(bookerType ?? 'user', config);" },
		{ code: 'const rate = termsFor(row.bookerType, reservationConfig).hourlyRateCents;' },
		{ code: 'const minSlots = minSlotsFor(bookerType, config);' },
		{ code: 'const slots = 60 / config.timeSlotMinutes;' },
		{ code: 'if (horizon > data.maxAdvanceDaysOneoff) f();' }
	],
	invalid: [
		{
			code: 'const minSlots = config.minDurationHours * (60 / config.timeSlotMinutes);',
			errors: [{ messageId: 'throughTerms' }]
		},
		{
			code: 'const days = Math.floor(reservationConfig.maxAdvanceDaysOneoff);',
			errors: [{ messageId: 'throughTerms' }]
		},
		{
			code: 'const out = { hourlyRateCents: cfg.hourlyRateCents };',
			errors: [{ messageId: 'throughTerms' }]
		},
		{
			code: 'const days = config.maxAdvanceDaysRecurring;',
			errors: [{ messageId: 'throughTerms' }]
		}
	]
});
