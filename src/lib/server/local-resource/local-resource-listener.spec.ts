import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A public tip (#1498): staff hear a tip arrived, and the submitter hears the
 * outcome either way, with the note when it is returned.
 */

type Handler = (e: { data: unknown }) => Promise<void>;
const handlers = new Map<string, Handler>();

vi.mock('$lib/server/event-bus', () => ({
	domainEvents: { on: (name: string, fn: Handler) => handlers.set(name, fn) }
}));
const dispatch = vi.fn(async (..._a: unknown[]) => undefined);
const dispatchEmailOnly = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/notification/dispatcher', () => ({ dispatch, dispatchEmailOnly }));
vi.mock('$lib/server/authorization', () => ({
	listUsersWithCapability: vi.fn(async () => [
		{ id: 's-1', name: 'Sam', email: 'sam@x.example' },
		{ id: 's-2', name: 'Ria', email: 'ria@x.example' }
	])
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { registerLocalResourceListeners } = await import('./local-resource-listener');
registerLocalResourceListeners();

beforeEach(() => {
	dispatch.mockClear();
	dispatchEmailOnly.mockClear();
});

describe('local_resource.submitted', () => {
	it('tells everyone who can review it, in-app', async () => {
		await handlers.get('local_resource.submitted')!({
			data: { resourceId: 'lr-1', name: 'Amp Doctor' }
		});

		expect(dispatch).toHaveBeenCalledTimes(2);
		expect(dispatch.mock.calls[0][0]).toMatchObject({
			type: 'local_resource_submitted',
			userId: 's-1',
			href: '/staff/local-resources/lr-1'
		});
	});
});

describe('local_resource.reviewed', () => {
	it('emails the submitter that the listing is live', async () => {
		await handlers.get('local_resource.reviewed')!({
			data: {
				resourceId: 'lr-1',
				name: 'Amp Doctor',
				submitterEmail: 't@x.example',
				published: true,
				staffNote: null
			}
		});

		const call = dispatchEmailOnly.mock.calls[0][0] as {
			toEmail: string;
			email: { subject: string; quote?: string };
		};
		expect(call.toEmail).toBe('t@x.example');
		expect(call.email.subject).toContain('Amp Doctor');
		expect(call.email.quote).toBeUndefined();
	});

	it('carries the staff note when the listing is returned', async () => {
		await handlers.get('local_resource.reviewed')!({
			data: {
				resourceId: 'lr-1',
				name: 'Amp Doctor',
				submitterEmail: 't@x.example',
				published: false,
				staffNote: 'Needs a website'
			}
		});

		const call = dispatchEmailOnly.mock.calls[0][0] as { email: { quote?: string } };
		expect(call.email.quote).toBe('Needs a website');
	});
});
