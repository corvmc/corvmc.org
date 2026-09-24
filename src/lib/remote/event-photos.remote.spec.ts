import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each recap-photo write must refuse a caller without `event.manage` before
// any service call, and must pass the event id it was given through as the
// scope — never a client-supplied route param.

let allowed = false;
let canUploadRecap = false;
let photographer = false;
let signedIn = true;
const requireCapability = vi.fn(async (cap: string) => {
	if (!allowed) throw new Error(`403: ${cap}`);
	return { id: 'staff-1' };
});
const can = vi.fn(async () => canUploadRecap);
const requireUser = vi.fn(() => {
	if (!signedIn) throw new Error('401');
	return { id: canUploadRecap ? 'staff-1' : 'member-1' };
});
vi.mock('$lib/server/authorization', () => ({ requireCapability, can, requireUser }));

// The per-event lookup itself is pinned in recap-access.spec.ts.
const recapUploadAccess = vi.fn(async (_userId: string | undefined, _eventId: string) =>
	canUploadRecap ? 'capability' : photographer ? 'photographer' : null
);
vi.mock('$lib/server/event/recap-access', () => ({ recapUploadAccess }));

vi.mock('@sveltejs/kit', () => ({
	error: (status: number, message: string) => {
		throw new Error(`${status}: ${message}`);
	}
}));

const svc = {
	addEventPhotos: vi.fn(async () => undefined),
	removeEventPhoto: vi.fn(async () => undefined),
	describeEventPhoto: vi.fn(async () => undefined)
};
vi.mock('$lib/server/event/event-photo-service', () => svc);

const refresh = vi.fn();
const refreshPublic = vi.fn();
vi.mock('$lib/remote/events.remote', () => ({
	getStaffEventPage: () => ({ refresh }),
	getPublicEventDetail: () => ({ refresh: refreshPublic })
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
	canUploadRecap = false;
	photographer = false;
	signedIn = true;
	vi.clearAllMocks();
});

const photo = new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' });

describe('event-photos.remote', () => {
	it.each([
		['removeEventPhoto', { eventId: 'e1', attachmentId: 'a1' }],
		['describeEventPhoto', { eventId: 'e1', attachmentId: 'a1', altText: 'x', caption: '' }]
	])('%s refuses a caller without event.manage before any service call', async (name, data) => {
		await expect(remote[name](data)).rejects.toThrow('403: event.manage');
		for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
	});

	it('refuses an upload from a member who is neither capable nor a photographer', async () => {
		await expect(remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] })).rejects.toThrow(
			'403'
		);
		expect(svc.addEventPhotos).not.toHaveBeenCalled();
	});

	it('refuses an upload from a signed-out caller', async () => {
		signedIn = false;
		await expect(remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] })).rejects.toThrow(
			'401'
		);
		expect(svc.addEventPhotos).not.toHaveBeenCalled();
	});

	it('uploads for a holder of event.uploadRecap, refreshing both pages', async () => {
		canUploadRecap = true;
		await remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] });
		expect(recapUploadAccess).toHaveBeenCalledWith('staff-1', 'e1');
		expect(svc.addEventPhotos).toHaveBeenCalledWith('e1', 'staff-1', [photo]);
		expect(refreshPublic).toHaveBeenCalled();
		expect(refresh).toHaveBeenCalled();
	});

	// #1500: a volunteer photographer is whoever is confirmed on this show's
	// documentation work order, so the check is asked about this event.
	it("uploads for the member confirmed on this event's documentation work order", async () => {
		photographer = true;
		await remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] });
		expect(recapUploadAccess).toHaveBeenCalledWith('member-1', 'e1');
		expect(svc.addEventPhotos).toHaveBeenCalledWith('e1', 'member-1', [photo]);
		expect(refreshPublic).toHaveBeenCalled();
		// They cannot read the staff console, so it is not theirs to refresh.
		expect(refresh).not.toHaveBeenCalled();
	});

	it('drops empty file inputs rather than uploading zero-byte files', async () => {
		canUploadRecap = true;
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
