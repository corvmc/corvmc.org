import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { TAB_KEYS, TAB_LABELS } from './tabs';
import '#lib/test/locators.js';

/**
 * The console is back-of-house only (#1950): every public-facing listing
 * feature lives on `/staff/events/[id]`, and this page links back to it.
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
		'addProductionExpense addRunOfShowSlot advanceProduction askForArtifact ' +
			'buildRunOfShowFromLineup createProduction createShow dropArtifactRequest markSlotTiming ' +
			'moveRunOfShowSlot openHostShift recordActPayout recordDoorTake removeProductionExpense ' +
			'removeRunOfShowSlot reopenProduction setProductionProducer setRunOfShowTerms ' +
			'undoActPayout updateProduction updateRunOfShowSlot usePosterArt ' +
			'usePosterArtWithFooter useTemplateFlyerAsPoster'
	)
);
vi.mock('#lib/remote/layout.remote.js', () =>
	stubs('getStaffLayout', { getStaffLayout: remote(() => ({ capabilities: [] })) })
);
vi.mock('#lib/remote/volunteer.remote.js', () =>
	stubs(
		'acceptShiftInvitation approveVolunteerHours assignShiftToMember cancelMySignup ' +
			'cancelShift claimShift confirmSignup confirmSignups createShift declineShiftInvitation ' +
			'duplicateShift editVolunteerHours getActiveCertifications getShiftCandidates ' +
			'getVolunteerRoles inviteMemberToShift logHoursForMember markSignupNoShow ' +
			'markSignupNotified notifyCancelledShift releaseSignup submitVolunteerHours updateShift'
	)
);
vi.mock('#lib/remote/duty-lists.remote.js', () => stubs('applyDutyList setWorkTaskDone'));
vi.mock('#lib/remote/external-acts.remote.js', () =>
	stubs('listActInDirectory searchAskableListings')
);
vi.mock('#lib/remote/deliverables.remote.js', () => stubs('reassignDeliverableForm'));
vi.mock('$app/state', async (original) => ({
	...(await original<Record<string, unknown>>()),
	page: {
		params: { id: 'evt-1' },
		url: new URL('http://localhost/staff/events/evt-1/production')
	}
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	replaceState: vi.fn(),
	refreshAll: vi.fn(),
	beforeNavigate: vi.fn()
}));

const Console = (await import('./+page.svelte')).default;

const startsAt = new Date('2031-05-10T03:00:00Z');

function loaded(production: unknown) {
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
		shifts: [],
		advance: [],
		volunteerRoles: [],
		dutyLists: [],
		riders: [],
		production,
		runOfShow: null,
		settlement: null,
		artifactRequests: [],
		requestableActs: [],
		hostShift: null,
		deliverables: [],
		deliverableCommittees: [],
		budget: null
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
	actsWanted: null
};

describe('production console', () => {
	it('links back to the listing and renders none of its sections', async () => {
		fixture.loaded = loaded(record);
		await render(Console);

		await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible();
		// The header's one action is the way back to the listing; the listing's
		// own Edit and Repeat actions are not carried over.
		const header = page.getByCss('[data-page-header]');
		await expect.element(header.getByCss('a.btn[href="/staff/events/evt-1"]')).toBeVisible();
		expect(header.element().querySelectorAll('.btn')).toHaveLength(1);

		for (const name of ['The night', 'Poster', 'Ticketing', 'Space Reservation']) {
			await expect
				.element(page.getByRole('heading', { name, exact: true }))
				.not.toBeInTheDocument();
		}
		expect(document.querySelector('a[href="/staff/events/evt-1/check-in"]')).toBeNull();
		// The console's tabs and nothing else: no listing tab such as Tickets.
		expect(page.getByRole('tab').elements()).toHaveLength(TAB_KEYS.length);
		await expect.element(page.getByRole('tab', { name: TAB_LABELS.settlement })).toBeVisible();
	});

	it('opens a production from its empty state', async () => {
		fixture.loaded = loaded(null);
		await render(Console);

		// The empty state's one form is the one that opens the record.
		await expect.element(page.getByCss('button[type="submit"]')).toBeVisible();
	});
});
