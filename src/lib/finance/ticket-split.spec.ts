import { describe, it, expect } from 'vitest';
import {
	actsAnchoredCollectiveCents,
	computeTicketSplit,
	suggestedCollectiveCents,
	validateTicketSplit
} from './ticket-split';
import { calculateTotalWithFeeCoverage } from './fees';
import { TICKET_MIN_CHARGE_CENTS } from '$lib/config';

/**
 * The commercial model of a ticket, to the cent. What the buyer is shown, what
 * lands on the ticket row, and what staff settle from are all this module's
 * output — so this file is the agreed table, not a sanity check.
 */
const base = { quantity: 1, coverFees: false, suggestedUnitCents: 1500, floorCents: 0 };

describe('the default position', () => {
	it('divides a $15 ticket into 74¢ of card, and 30/70 of what is left', () => {
		const fee = computeTicketSplit({
			...base,
			unitPriceCents: 1500,
			collectiveCents: 0
		}).stripeFeeCents;
		expect(fee).toBe(74); // 2.9% + 30¢

		// 30% of what is actually divisible, not of the gross. $4.28, not $4.50 —
		// the difference is the fee, which nobody on either side receives.
		const collective = suggestedCollectiveCents(1500 - fee);
		expect(collective).toBe(428);

		const split = computeTicketSplit({
			...base,
			unitPriceCents: 1500,
			collectiveCents: collective
		});
		expect(split.chargeCents).toBe(1500);
		expect(split.collectiveCents).toBe(428);
		expect(split.actsCents).toBe(998);
		expect(split.contributionCents).toBe(0);
	});

	it('always reconciles: acts + collective + card equals the charge', () => {
		// The property that makes a rounding gap impossible. `actsCents` is derived
		// from the charge rather than computed independently for this reason.
		for (const unitPriceCents of [200, 333, 500, 1500, 2000, 9999]) {
			for (const quantity of [1, 2, 5]) {
				for (const coverFees of [false, true]) {
					const fee = computeTicketSplit({
						...base,
						unitPriceCents,
						quantity,
						coverFees,
						collectiveCents: 0
					}).stripeFeeCents;
					const divisible = unitPriceCents * quantity - fee;
					for (const collectiveCents of [0, 1, suggestedCollectiveCents(divisible), divisible]) {
						const s = computeTicketSplit({
							...base,
							unitPriceCents,
							quantity,
							coverFees,
							collectiveCents
						});
						expect(
							s.actsCents + s.collectiveCents + s.stripeFeeCents,
							`${unitPriceCents}×${quantity} cover=${coverFees} c=${collectiveCents}`
						).toBe(s.chargeCents);
					}
				}
			}
		}
	});

	it('lets the buyer refuse the collective entirely', () => {
		const split = computeTicketSplit({ ...base, unitPriceCents: 1500, collectiveCents: 0 });
		expect(split.collectiveCents).toBe(0);
		expect(split.actsCents).toBe(1500 - split.stripeFeeCents);
	});
});

describe('covering fees', () => {
	it('adds the surcharge on top so the acts keep the whole amount', () => {
		const split = computeTicketSplit({
			...base,
			unitPriceCents: 1500,
			collectiveCents: 0,
			coverFees: true
		});
		expect(split.chargeCents).toBe(1576);
		expect(split.feeCoveredCents).toBe(76);
		expect(split.actsCents).toBe(1500);
	});

	it('quotes the same surcharge checkout will actually charge', () => {
		// The preview and the charge come from two different call sites — this
		// module and `checkout()` — and they have to agree at every amount above
		// the dead zone, or a buyer is told one total and billed another.
		for (const totalCents of [200, 333, 500, 1500, 2000, 9999, 100_000]) {
			const split = computeTicketSplit({
				...base,
				unitPriceCents: totalCents,
				collectiveCents: 0,
				coverFees: true
			});
			expect(split.feeCoveredCents, `${totalCents}`).toBe(
				calculateTotalWithFeeCoverage(totalCents).feeCents
			);
		}
	});
});

describe('paying above the suggestion is a contribution', () => {
	it('splits the excess into its own line, once per order', () => {
		const split = computeTicketSplit({
			...base,
			unitPriceCents: 2000,
			quantity: 2,
			collectiveCents: 0
		});
		expect(split.ticketLineUnitCents).toBe(1500);
		expect(split.contributionCents).toBe(1000);
		// And the two still describe the whole amount charged.
		expect(split.ticketLineUnitCents * 2 + split.contributionCents).toBe(split.chargeCents);
	});

	it('does not make paying less a negative contribution', () => {
		const split = computeTicketSplit({ ...base, unitPriceCents: 500, collectiveCents: 0 });
		expect(split.contributionCents).toBe(0);
		expect(split.ticketLineUnitCents).toBe(500);
	});

	it('is zero at exactly the suggested price', () => {
		expect(
			computeTicketSplit({ ...base, unitPriceCents: 1500, collectiveCents: 0 }).contributionCents
		).toBe(0);
	});
});

describe('validateTicketSplit', () => {
	it('accepts the scale at zero on a floor-0 show, and charges nothing', () => {
		const result = validateTicketSplit({
			...base,
			unitPriceCents: 0,
			collectiveCents: 0,
			floorCents: 0
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.chargeCents).toBe(0);
	});

	it('refuses zero when the act asked for a floor', () => {
		const result = validateTicketSplit({
			...base,
			unitPriceCents: 0,
			collectiveCents: 0,
			floorCents: 1000
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('$10.00');
	});

	it('refuses the dead zone between free and the charge minimum', () => {
		const result = validateTicketSplit({ ...base, unitPriceCents: 100, collectiveCents: 0 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain('$2.00');
	});

	it('lets a small amount through once the ORDER clears the minimum', () => {
		// $1 a ticket is inside the dead zone; three of them is a $3 charge, which
		// is not. The floor is per order because the charge is.
		expect(
			validateTicketSplit({ ...base, unitPriceCents: 100, quantity: 3, collectiveCents: 0 }).ok
		).toBe(true);
		expect(TICKET_MIN_CHARGE_CENTS).toBe(200);
	});

	it('refuses a negative allocation, which would pay the collective out of the acts', () => {
		expect(
			validateTicketSplit({ ...base, unitPriceCents: 1500, collectiveCents: -500 })
		).toMatchObject({ ok: false });
	});

	it('refuses an allocation that leaves the acts nothing', () => {
		expect(
			validateTicketSplit({ ...base, unitPriceCents: 1500, collectiveCents: 1500 })
		).toMatchObject({ ok: false });
	});

	it('refuses a fractional unit price even when the order total is whole', () => {
		// 2 × $12.505 is a whole-cent total and an impossible ticket row.
		expect(
			validateTicketSplit({
				...base,
				unitPriceCents: 1250.5,
				quantity: 2,
				collectiveCents: 0
			})
		).toMatchObject({ ok: false });
	});

	it('refuses a quantity that is not a positive whole number', () => {
		for (const quantity of [0, -1, 2.5]) {
			expect(
				validateTicketSplit({ ...base, unitPriceCents: 1500, quantity, collectiveCents: 0 }),
				`${quantity}`
			).toMatchObject({ ok: false });
		}
	});

	it('recomputes the fee rather than believing a posted one', () => {
		// There is nowhere in the input for a client to put a fee at all, which is
		// the strongest form of not trusting it.
		//
		// The figures moved in #827: at the suggestion the acts take 70% of the
		// $15 gross — $10.50 — rather than 70% of the $14.26 left after the card
		// fee, and the collective is what remains. This case used to post 428 and
		// expect 998, which is the proportional split that shorted the acts.
		const result = validateTicketSplit({ ...base, unitPriceCents: 1500, collectiveCents: 376 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.split.stripeFeeCents).toBe(74);
			expect(result.split.actsCents).toBe(1050);
		}
	});

	it('accepts paying well above the suggestion', () => {
		const result = validateTicketSplit({ ...base, unitPriceCents: 10_000, collectiveCents: 0 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.contributionCents).toBe(8500);
	});
});

/**
 * The acts' take is anchored to the base rate, not to what the buyer paid (#827).
 *
 * A proportional split hands the acts 70% of a discount as well as of a sale,
 * so a NOTAFLOF buyer shorts the band rather than the collective. Here their
 * number is absolute and the collective is the residual.
 */
describe('the acts are paid off the base rate', () => {
	const show = { quantity: 1, coverFees: false, suggestedUnitCents: 1000, floorCents: 0 };

	it.each([
		// paid,  acts,  collective   — base $10 at the default 70/30
		[500, 455, 0], // below the floor: the acts take the whole divisible amount
		[700, 649, 0], // NOTAFLOF: $7 paid sends $7 to the acts, nothing to CMC
		[1000, 700, 241], // at the suggestion: acts get exactly 70% of $10
		[1500, 1050, 376] // above it: the surplus splits at the same ratio
	])('$%i paid → acts %i¢, collective %i¢', (paid, acts, collective) => {
		const split = computeTicketSplit({
			...show,
			unitPriceCents: paid,
			collectiveCents: actsAnchoredCollectiveCents({
				baseCents: show.suggestedUnitCents,
				grossPaidCents: paid,
				coverFees: false
			})
		});
		expect(split.actsCents).toBe(acts);
		expect(split.collectiveCents).toBe(collective);
	});

	it('never lets the collective take money the acts are owed', () => {
		// The bar's UI clamps this; the UI is not the guard.
		const result = validateTicketSplit({
			...show,
			unitPriceCents: 1000,
			collectiveCents: 941 // the whole divisible amount
		});
		expect(result).toEqual({ ok: false, reason: 'That leaves the acts short.' });
	});

	it('lets a buyer opt the acts up, but never down', () => {
		const result = validateTicketSplit({ ...show, unitPriceCents: 1000, collectiveCents: 0 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.split.actsCents).toBe(941);
	});

	/**
	 * The guarantee is a share of the *suggested* price, so it does not rise
	 * with what the buyer paid. A floor that did would cap the gift being made:
	 * on this show it would hold the acts at $10.50 and leave the collective a
	 * ceiling of $3.76, when the buyer meant the extra $5 for them.
	 */
	describe("the surplus above the suggestion is the buyer's to direct", () => {
		// $15 paid on a $10 show: $14.26 divisible, and the acts' $7.00 guarantee
		// leaves $7.26 the buyer may send to the collective.
		const overpaid = { ...show, unitPriceCents: 1500 };

		it('still opens at the same place — only the ceiling moves', () => {
			expect(
				actsAnchoredCollectiveCents({
					baseCents: show.suggestedUnitCents,
					grossPaidCents: 1500,
					coverFees: false
				})
			).toBe(376);
		});

		it("accepts an allocation up to the acts' guarantee", () => {
			const result = validateTicketSplit({ ...overpaid, collectiveCents: 726 });
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.split.actsCents).toBe(700);
		});

		it('refuses the cent past it', () => {
			expect(validateTicketSplit({ ...overpaid, collectiveCents: 727 })).toEqual({
				ok: false,
				reason: 'That leaves the acts short.'
			});
		});
	});
});
