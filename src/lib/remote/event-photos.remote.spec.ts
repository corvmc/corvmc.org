import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each recap-photo write must refuse a caller without `event.manage` before
// any service call, and must pass the event id it was given through as the
// scope — never a client-supplied route param.

let allowed = false;
let canUploadRecap = false;
/** The one event a live volunteer-role grant covers, or null once the window closes. */
let crewEvent: string | null = null;
let signedIn = true;
const requireCapability = vi.fn(async (cap: string) => {
	if (!allowed) throw new Error(`403: ${cap}`);
	return { id: 'staff-1' };
});
const can = vi.fn(async (_cap: string, scope?: { eventId?: string }) =>
	scope?.eventId ? scope.eventId === crewEvent : canUploadRecap
);
const requireUser = vi.fn(() => {
	if (!signedIn) throw new Error('401');
	return { id: canUploadRecap ? 'staff-1' : 'member-1' };
});
vi.mock('$lib/server/authorization', () => ({ requireCapability, can, requireUser }));

vi.mock('@sveltejs/kit', () => ({
	error: (status: number, message: string) => {
		throw new Error(`${status}: ${message}`);
	}
}));

const svc = {
	addEventPhotos: vi.fn(async () => undefined),
	removeEventPhoto: vi.fn(async () => undefined),
	describeEventPhoto: vi.fn(async () => undefined),
	setEventRecapText: vi.fn(async () => undefined)
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
	crewEvent = null;
	signedIn = true;
	vi.clearAllMocks();
});

const photo = new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' });

describe('event-photos.remote', () => {
	it.each([
		['removeEventPhoto', { eventId: 'e1', attachmentId: 'a1' }],
		['describeEventPhoto', { eventId: 'e1', attachmentId: 'a1', altText: 'x', caption: '' }],
		['saveEventRecapText', { eventId: 'e1', recapText: 'A good night' }]
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
		expect(can).toHaveBeenCalledWith('event.uploadRecap');
		expect(svc.addEventPhotos).toHaveBeenCalledWith('e1', 'staff-1', [photo]);
		expect(refreshPublic).toHaveBeenCalled();
		expect(refresh).toHaveBeenCalled();
	});

	// #1500: the show's photographer holds a volunteer-role grant for that show alone.
	it("uploads for a member on this event's documentation crew", async () => {
		crewEvent = 'e1';
		await remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] });
		expect(can).toHaveBeenCalledWith('event.uploadRecap', { eventId: 'e1' });
		expect(svc.addEventPhotos).toHaveBeenCalledWith('e1', 'member-1', [photo]);
		expect(refreshPublic).toHaveBeenCalled();
		// They cannot read the staff console, so it is not theirs to refresh.
		expect(refresh).not.toHaveBeenCalled();
	});

	it("refuses the crew of another event: the grant names the form's event, not the member", async () => {
		crewEvent = 'e2';
		await expect(remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] })).rejects.toThrow(
			'403'
		);
		expect(svc.addEventPhotos).not.toHaveBeenCalled();
	});

	it('refuses the crew once the grace window has closed', async () => {
		// The resolver answers false after the window; capability-grants.spec pins when.
		crewEvent = null;
		await expect(remote.uploadEventPhotos({ eventId: 'e1', photos: [photo] })).rejects.toThrow(
			'403'
		);
		expect(can).toHaveBeenCalledWith('event.uploadRecap', { eventId: 'e1' });
		expect(svc.addEventPhotos).not.toHaveBeenCalled();
	});

	it('drops empty file inputs rather than uploading zero-byte files', async () => {
		canUploadRecap = true;
		const empty = new File([], '', { type: 'application/octet-stream' });
		await remote.uploadEventPhotos({ eventId: 'e1', photos: [empty, photo] });
		expect(svc.addEventPhotos).toHaveBeenCalledWith('e1', 'staff-1', [photo]);
	});

	it('saves the written recap for event.manage and refreshes both pages (#1401)', async () => {
		allowed = true;
		await remote.saveEventRecapText({ eventId: 'e1', recapText: 'A good night' });
		expect(requireCapability).toHaveBeenCalledWith('event.manage');
		expect(svc.setEventRecapText).toHaveBeenCalledWith('e1', 'A good night');
		expect(refresh).toHaveBeenCalled();
		expect(refreshPublic).toHaveBeenCalled();
	});

	// A photographer may upload, but the paragraph is staff's to write.
	it('refuses the written recap to a photographer without event.manage', async () => {
		crewEvent = 'e1';
		await expect(remote.saveEventRecapText({ eventId: 'e1', recapText: 'Mine' })).rejects.toThrow(
			'403: event.manage'
		);
		expect(svc.setEventRecapText).not.toHaveBeenCalled();
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
