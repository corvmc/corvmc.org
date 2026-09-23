import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each recap-photo write must refuse a caller without `event.manage` before
// any service call, and must pass the event id it was given through as the
// scope — never a client-supplied route param.

let allowed = false;
const requireCapability = vi.fn(async (cap: string) => {
	if (!allowed) throw new Error(`403: ${cap}`);
	return { id: 'staff-1' };
});
vi.mock('$lib/server/authorization', () => ({ requireCapability }));

const svc = {
	addEventPhotos: vi.fn(async () => undefined),
	removeEventPhoto: vi.fn(async () => undefined),
	describeEventPhoto: vi.fn(async () => undefined)
};
vi.mock('$lib/server/event/event-photo-service', () => svc);

const refresh = vi.fn();
vi.mock('$lib/remote/events.remote', () => ({
	getStaffEventPage: () => ({ refresh })
}));

vi.mock('$app/server', () => ({
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		(handler as unknown as Record<string, unknown>).__ = { type: 'form' };
		return handler;
	}
}));

const remote = (await import('./event-photos.remote')) as unknown as Record<
	string,
	(data: unknown, issue?: unknown) => Promise<unknown>
>;

beforeEach(() => {
	allowed = false;
	vi.clearAllMocks();
});

const photo = new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' });

describe('event-photos.remote', () => {
	it.each([
		['uploadEventPhotos', { eventId: 'e1', photos: [photo] }],
		['removeEventPhoto', { eventId: 'e1', attachmentId: 'a1' }],
		['describeEventPhoto', { eventId: 'e1', attachmentId: 'a1', altText: 'x', caption: '' }]
	])('%s refuses a caller without event.manage before any service call', async (name, data) => {
		await expect(remote[name](data)).rejects.toThrow('403: event.manage');
		for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
	});

	it('uploads as the guarded user, then refreshes the staff page', async () => {
		allowed = true;
		await remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] });
		expect(svc.addEventPhotos).toHaveBeenCalledWith('e1', 'staff-1', [photo]);
		expect(refresh).toHaveBeenCalled();
	});

	it('drops empty file inputs rather than uploading zero-byte files', async () => {
		allowed = true;
		const empty = new File([], '', { type: 'application/octet-stream' });
		await remote.uploadEventPhotos({ eventId: 'e1', photos: [empty, photo] });
		expect(svc.addEventPhotos).toHaveBeenCalledWith('e1', 'staff-1', [photo]);
	});

	it('scopes removal and description to the event', async () => {
		allowed = true;
		await remote.removeEventPhoto({ eventId: 'e1', attachmentId: 'a1' });
		expect(svc.removeEventPhoto).toHaveBeenCalledWith('e1', 'a1');
		await remote.describeEventPhoto({
			eventId: 'e1',
			attachmentId: 'a1',
			altText: ' Crowd ',
			caption: ''
		});
		expect(svc.describeEventPhoto).toHaveBeenCalledWith('e1', 'a1', {
			altText: 'Crowd',
			caption: null
		});
	});
});
