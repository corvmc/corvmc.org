import { describe, it, expect, vi, beforeEach } from 'vitest';

// Crew filing (#1469) is `incident.file` for the form's event: a volunteer-role
// grant, which the resolver answers per event and per window. This pins that the
// remote asks with that event, and files nothing when refused.

let signedIn = true;
/** The event a live role grant covers, or null once the window has closed. */
let crewEvent: string | null = null;
const requireCapability = vi.fn(async (cap: string, scope?: { eventId?: string }) => {
	if (!signedIn) throw Object.assign(new Error('401'), { status: 401 });
	if (cap !== 'incident.file' || scope?.eventId !== crewEvent) {
		throw Object.assign(new Error('403'), { status: 403 });
	}
	return { id: 'vol-1', name: 'Vee' };
});
vi.mock('$lib/server/authorization', () => ({ requireCapability, can: vi.fn() }));

const fileShowIncident = vi.fn(async () => undefined);
vi.mock('$lib/server/incident/incident-service', () => ({
	fileShowIncident,
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
vi.mock('$lib/server/errors', () => ({
	mapDomainError: (err: unknown) => {
		throw err;
	}
}));
vi.mock('$app/server', () => ({
	query: (...args: unknown[]) =>
		Object.assign(typeof args[0] === 'function' ? args[0] : (args[1] as object), {
			__: { type: 'query' }
		}),
	form: (schema: { parse: (v: unknown) => unknown }, handler: (d: unknown) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw)), { __: { type: 'form' } }),
	command: (_s: unknown, handler: object) => Object.assign(handler, { __: { type: 'command' } })
}));

const { fileShowIncidentForm } = (await import('./incidents.remote')) as unknown as Record<
	string,
	(raw: unknown) => Promise<unknown>
>;

const filing = (eventId: string) => ({
	eventId,
	occurredOn: '2026-09-20',
	occurredAt: '22:15',
	category: 'noise_complaint',
	summary: 'Neighbour complaint',
	description: 'A neighbour knocked about the volume during the last set.'
});

beforeEach(() => {
	vi.clearAllMocks();
	signedIn = true;
	crewEvent = null;
});

describe('fileShowIncidentForm', () => {
	it("files for a member holding incident.file for this event's crew", async () => {
		crewEvent = 'ev-1';
		await expect(fileShowIncidentForm(filing('ev-1'))).resolves.toEqual({ success: true });
		expect(requireCapability).toHaveBeenCalledWith('incident.file', { eventId: 'ev-1' });
		expect(fileShowIncident).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'ev-1' }), {
			id: 'vol-1',
			name: 'Vee'
		});
	});

	it('refuses the crew of another event, filing nothing', async () => {
		crewEvent = 'ev-2';
		await expect(fileShowIncidentForm(filing('ev-1'))).rejects.toMatchObject({ status: 403 });
		expect(fileShowIncident).not.toHaveBeenCalled();
	});

	it('refuses once the grant window has closed, filing nothing', async () => {
		// The resolver answers false after the grace period; capability-grants.spec pins when.
		await expect(fileShowIncidentForm(filing('ev-1'))).rejects.toMatchObject({ status: 403 });
		expect(fileShowIncident).not.toHaveBeenCalled();
	});

	it('refuses a signed-out caller', async () => {
		signedIn = false;
		await expect(fileShowIncidentForm(filing('ev-1'))).rejects.toMatchObject({ status: 401 });
		expect(fileShowIncident).not.toHaveBeenCalled();
	});
});
