import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

/**
 * The Production tab (#3270): back-of-house only, stacked with no inner tabs.
 * Every public-facing listing feature lives on the Listing tab.
 */

const fixture = vi.hoisted(() => ({ loaded: null as unknown }));

// One stand-in for every remote: callable as a query, shaped as a form.
const remote = vi.hoisted(() => (value: () => unknown = () => undefined) => {
	const fields = new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) =>
			target[key] ?? {
				as: (type: string, v?: unknown) => ({ type, name: key, value: v }),
				issues: () => null,
				value: () => undefined
			}
	});
	const fn = Object.assign(
		() => Object.assign(Promise.resolve(value()), { refresh: () => Promise.resolve() }),
		{ enhance: () => ({ method: 'POST' }), fields, result: undefined, pending: 0 }
	);
	return Object.assign(fn, { for: () => fn });
});

// Browser-mode mocks need every export the component graph imports, by name.
const stubs = vi.hoisted(
	() =>
		(names: string, overrides: Record<string, unknown> = {}) =>
			Object.fromEntries(names.split(' ').map((n) => [n, overrides[n] ?? remote()])) as Record<
				string,
				unknown
			>
);

vi.mock('#lib/remote/events.remote.js', () =>
	stubs(
		'cancelEvent cancelEventSeries cancelTicket checkConflicts checkRebook compTickets ' +
			'createEvent deleteEvent getEventDeletionImpact getEventPublishBlockers getProgramGroups ' +
			'getStaffEventProduction previewRecurringEvents publishEvent searchEvents ' +
			'startEventSeries unpublishEvent updateEvent',
		{ getStaffEventProduction: remote(() => fixture.loaded) }
	)
);
vi.mock('#lib/remote/productions.remote.js', () =>
	stubs(
		'addLineupAct addProductionExpense advanceProduction askForArtifact ' +
			'buildRunOfShowFromLineup createProduction createShow dropArtifactRequest markRunOfShowDone ' +
			'markSlotTiming moveRunOfShowSlot openHostShift recordActPayout recordStaffCount ' +
			'removeLineupAct removeProductionExpense reopenProduction ' +
			'searchShowLeadCandidates setRunOfShowTerms setRunOfShowTime ' +
			'setRiderStock setShowLead undoActPayout updateProduction updateRunOfShowSlot usePosterArt ' +
			'usePosterArtWithFooter useTemplateFlyerAsPoster'
	)
);
vi.mock('#lib/remote/layout.remote.js', () =>
	stubs('getStaffLayout', { getStaffLayout: remote(() => ({ capabilities: [] })) })
);
vi.mock('#lib/remote/volunteer.remote.js', () =>
	stubs(
		'acceptShiftInvitation approveVolunteerHours assignShiftToMember cancelMySignup ' +
			'cancelShift claimShift confirmShiftClaims confirmSignup confirmSignups declineShiftInvitation ' +
			'duplicateShift editVolunteerHours getActiveCertifications getShiftCandidates ' +
			'getVolunteerRoles inviteMemberToShift logHoursForMember markSignupNoShow ' +
			'markSignupNotified notifyCancelledShift releaseSignup setTrainedUnder submitVolunteerHours ' +
			'updateShift'
	)
);
vi.mock('#lib/remote/duty-lists.remote.js', () => stubs('applyDutyList setWorkTaskDone'));
vi.mock('#lib/remote/external-acts.remote.js', () =>
	stubs('listActInDirectory searchAskableListings searchBillActs')
);
vi.mock('#lib/remote/deliverables.remote.js', () => stubs('reassignDeliverableForm'));
vi.mock('#lib/remote/tasks.remote.js', () =>
	stubs('addRelatedShift createCatalogueTaskForm getRelatedShifts getRelatedTasks', {
		getRelatedTasks: remote(() => null),
		getRelatedShifts: remote(() => null)
	})
);
vi.mock('#lib/remote/member-related.remote.js', () =>
	stubs('getMemberRelatedShifts getMemberRelatedTasks')
);
vi.mock('$app/state', async (original) => ({
	...(await original<Record<string, unknown>>()),
	page: {
		params: { id: 'evt-1' },
		url: new URL('http://localhost/staff/events/evt-1/production')
	}
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	refreshAll: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ProductionTab = (await import('./ProductionTab.test.svelte')).default;
const props = { eventId: 'evt-1' };

const startsAt = new Date('2031-05-10T03:00:00Z');

function loaded(production: unknown, canSetLead = false) {
	return {
		detail: {
			event: {
				id: 'evt-1',
				title: 'Spring Showcase',
				source: 'cmc',
				status: 'published',
				startsAt,
				endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
				doorsAt: null,
				venueName: null,
				location: null,
				ticketingEnabled: true
			},
			posterUrl: '/poster.png',
			linkedReservation: null,
			ticketStats: { sold: 3, remaining: 77 },
			ticketMoney: null,
			tickets: []
		},
		dutyLists: [],
		riders: [],
		riderStock: { lines: [], unmatchedCount: 0, shortCount: 0, catalog: [] },
		production,
		runOfShow: null,
		settlement: null,
		artifactRequests: [],
		requestableActs: [],
		hostShift: null,
		deliverables: [],
		deliverableCommittees: [],
		budget: null,
		canSetLead
	};
}

const record = {
	id: 'prod-1',
	status: 'draft',
	producer: null,
	producerUserId: null,
	closedAt: null,
	closedByName: null,
	loadInAt: null,
	soundcheckAt: null,
	firstSetAt: null,
	curfewAt: null,
	loadOutBy: null,
	loadInDoneAt: null,
	soundcheckDoneAt: null,
	doorsDoneAt: null,
	curfewDoneAt: null,
	loadOutDoneAt: null,
	internalNotes: null,
	actsWanted: null
};

const slot = (n: number) => ({
	id: `slot-${n}`,
	eventBandId: `eb-${n}`,
	actName: `Act ${n}`,
	actStatus: 'unlinked',
	actSlug: null,
	actEntryId: null,
	actOrganizationId: null,
	sortOrder: n,
	setLengthMinutes: 30,
	changeoverMinutes: 15,
	scheduledStartAt: new Date(startsAt.getTime() + n * 45 * 60_000),
	actualStartAt: null,
	actualEndAt: null,
	scheduledEndAt: null,
	soundcheckAt: null,
	techNotes: null,
	backlineNeeds: null,
	hospitalityNotes: null,
	contactId: null,
	terms: {
		guaranteeCents: null,
		percentageBps: null,
		versus: false,
		againstNet: false,
		contributed: false
	}
});

const showOf = (count: number) => ({
	productionId: 'prod-1',
	firstSetAt: startsAt,
	curfewAt: null,
	changeoverMinutes: 15,
	slots: Array.from({ length: count }, (_, i) => slot(i + 1)),
	unslotted: [],
	warnings: []
});

describe('Production tab', () => {
	it('opens a production from its empty state', async () => {
		fixture.loaded = loaded(null);
		await render(ProductionTab, props);

		// One offer only: a remote form object attaches to a single <form>.
		await expect.element(page.getByCss('button[type="submit"]').first()).toBeVisible();
		await expect.element(page.getByTestId('settlement')).not.toBeInTheDocument();
	});

	it('lists what the bill asks for against stock, flagging the unmatched and the short', async () => {
		const act = {
			id: 'eb-1',
			name: 'Alpha',
			entryId: 'de-1',
			slug: 'alpha',
			channelCount: 4,
			phantomCount: 0,
			venueProvidedCount: 3,
			uploadCount: 0,
			empty: false
		};
		const lines = [
			{ id: 'el-1', match: null, short: false },
			{
				id: 'el-2',
				match: { via: 'category', categoryId: 'c', categoryName: 'Mics' },
				short: true
			},
			{ id: 'el-3', match: { via: 'link', itemId: 'i', itemName: 'Amp' }, short: false }
		].map((l) => ({
			elementId: l.id,
			actName: 'Alpha',
			label: l.id,
			kind: 'vocals',
			match: l.match,
			needed: 3,
			available: l.match ? 2 : null,
			short: l.short
		}));
		fixture.loaded = {
			...loaded(record),
			riders: [act],
			riderStock: { lines, unmatchedCount: 1, shortCount: 1, catalog: [] }
		};
		await render(ProductionTab, props);

		await expect.element(page.getByTestId('stock-line').first()).toBeVisible();
		expect(page.getByTestId('stock-line').elements()).toHaveLength(3);
		const [unmatched, short, linked] = page.getByTestId('stock-line').elements();
		expect(unmatched.querySelector('.badge-warning')).not.toBeNull();
		expect(short.querySelector('.badge-error')).not.toBeNull();
		expect(linked.querySelector('.badge-warning, .badge-error')).toBeNull();
	});

	describe('lineup and run of show (#3272)', () => {
		it('lists each act once, and the same acts as the sets between the fixed rows', async () => {
			fixture.loaded = { ...loaded(record), runOfShow: showOf(3), canBook: true };
			await render(ProductionTab, props);

			await expect.element(page.getByTestId('lineup-row').first()).toBeVisible();
			expect(page.getByTestId('lineup-row').elements()).toHaveLength(3);
			expect(page.getByTestId('run-of-show-set').elements()).toHaveLength(3);
		});

		// Doors is the listing's time: it is shown, never offered as a field.
		it('edits the production times but not doors', async () => {
			fixture.loaded = { ...loaded(record), runOfShow: showOf(1), canBook: true };
			await render(ProductionTab, props);

			await expect.element(page.getByTestId('run-of-show-doors')).toBeVisible();
			expect(
				document.querySelector('[data-testid="run-of-show-doors"] input[type="time"]')
			).toBeNull();
			for (const row of ['loadIn', 'soundcheck', 'curfew', 'loadOut']) {
				expect(
					document.querySelector(`[data-testid="run-of-show-${row}"] input[type="time"]`)
				).not.toBeNull();
			}
		});

		it('sets only the first set by hand; later sets follow from the order', async () => {
			fixture.loaded = { ...loaded(record), runOfShow: showOf(2), canBook: true };
			await render(ProductionTab, props);

			await expect.element(page.getByTestId('run-of-show-set').first()).toBeVisible();
			const [first, second] = page.getByTestId('run-of-show-set').elements();
			expect(first.querySelector('input[type="time"]')).not.toBeNull();
			expect(second.querySelector('input[type="time"]')).toBeNull();
		});
	});

	describe('settlement', () => {
		const night = (count: number | null, checkedIn: number, recordedCents = 100_00) => ({
			productionId: 'prod-1',
			eventId: 'evt-1',
			status: 'completed',
			collectiveRevenueCents: 0,
			actsPoolCents: 0,
			door: {
				cashCents: 100_00,
				recordedCents,
				gapCents: 100_00 - recordedCents,
				unrecordedCents: Math.max(0, 100_00 - recordedCents),
				count,
				actsPercent: 70,
				actsCents: 70_00,
				collectiveCents: 30_00,
				overridden: false
			},
			doorCounts: { check: 'single', first: { byName: null, at: null }, second: null },
			doorTakings: {
				card: { tickets: 1, grossCents: 15_00 },
				cash: { tickets: 0, grossCents: recordedCents },
				free: { tickets: 0, grossCents: 0 },
				donations: { count: 0, grossCents: 0 },
				checkedIn
			},
			expensesCents: 0,
			deductibleExpensesCents: 0,
			expenses: [],
			acts: [],
			suggestedPayoutTotalCents: 0,
			paidTotalCents: 0,
			unpaidActCount: 0,
			netCents: 0
		});
		const panel = () => page.getByTestId('settlement');

		// Warn, never refuse: the typed count is read against the check-ins (#2801).
		it('warns when the headcount differs from check-ins, and only then', async () => {
			fixture.loaded = { ...loaded(record), settlement: night(5, 3) };
			const { unmount } = await render(ProductionTab, props);
			await expect.element(panel().getByTestId('door-count-gap')).toBeVisible();
			unmount();

			fixture.loaded = { ...loaded(record), settlement: night(3, 3) };
			await render(ProductionTab, props);
			await expect.element(panel().getByCss('button[type="submit"]').first()).toBeVisible();
			expect(document.querySelector('[data-testid="door-count-gap"]')).toBeNull();
		});

		// Counted cash is read against the cash sales the door recorded (#2800).
		it('warns when the cash counted differs from cash sales recorded, and only then', async () => {
			fixture.loaded = { ...loaded(record), settlement: night(3, 3, 90_00) };
			const { unmount } = await render(ProductionTab, props);
			await expect.element(panel().getByTestId('door-cash-gap')).toBeVisible();
			unmount();

			fixture.loaded = { ...loaded(record), settlement: night(3, 3) };
			await render(ProductionTab, props);
			await expect.element(panel().getByTestId('door-cash-recorded')).toBeVisible();
			expect(document.querySelector('[data-testid="door-cash-gap"]')).toBeNull();
		});
	});
});
