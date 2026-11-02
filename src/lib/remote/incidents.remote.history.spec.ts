import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reopen and retention write audit entries (#2206). A form that refreshes a
// query by name skips Kit's refresh-everything, so each must name the History
// card's query too or the card shows the page as it was before the write.

vi.mock('$lib/server/authorization', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1', name: 'Pat' })),
	can: vi.fn()
}));
vi.mock('$lib/server/incident/incident-service', () => ({
	fileShowIncident: vi.fn(),
	acceptIncident: vi.fn(),
	addIncidentNote: vi.fn(),
	getIncident: vi.fn(),
	listIncidents: vi.fn(),
	recordIncident: vi.fn(),
	reopenIncident: vi.fn(),
	resolveIncident: vi.fn(),
	INCIDENT_DESCRIPTION_MAX: 5000,
	INCIDENT_LOCATION_MAX: 200,
	INCIDENT_NOTE_MAX: 2000,
	INCIDENT_SUMMARY_MAX: 200
}));
vi.mock('$lib/server/incident/incident-retention', () => ({ setIncidentRetain: vi.fn() }));
vi.mock('$lib/server/audit/audit-feed', () => ({ listAuditFeed: vi.fn() }));

const refreshed: [unknown, unknown][] = [];
vi.mock('$app/server', () => ({
	query: () => {
		const q = (arg: unknown) => ({
			refresh: () => {
				refreshed.push([q, arg]);
				return Promise.resolve();
			}
		});
		return Object.assign(q, { __: { type: 'query' } });
	},
	form: (schema: { parse: (v: unknown) => unknown }, handler: (d: unknown) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw)), { __: { type: 'form' } }),
	command: (_s: unknown, handler: object) => Object.assign(handler, { __: { type: 'command' } })
}));

const remote = (await import('./incidents.remote')) as unknown as Record<
	string,
	(raw: unknown) => Promise<unknown>
>;

beforeEach(() => {
	refreshed.length = 0;
});

describe('incident writes that audit refresh the History card', () => {
	it('reopen', async () => {
		await remote.reopenIncidentForm({ incidentId: 'inc-1' });
		expect(refreshed).toContainEqual([remote.getIncidentHistory, { id: 'inc-1' }]);
	});

	it('retain and release', async () => {
		await remote.setIncidentRetainForm({ incidentId: 'inc-1', retain: 'true', reason: 'Claim' });
		expect(refreshed).toContainEqual([remote.getIncidentHistory, { id: 'inc-1' }]);
	});
});
