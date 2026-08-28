import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBand = {
	id: 'band-1',
	name: 'The Velvet Underground',
	slug: 'the-velvet-underground',
	bio: 'NYC band',
	ownerId: 'user-owner',
	avatarKey: null,
	memberCount: 3,
	createdAt: new Date(),
	updatedAt: new Date()
};

const bandServiceMock = {
	getBySlug: vi.fn(async () => mockBand),
	getByIdActive: vi.fn(async () => mockBand),
	getUserRole: vi.fn(async () => 'owner' as string | null),
	update: vi.fn(async () => ({
		...mockBand,
		name: 'New Name',
		slug: 'new-name'
	}))
};

vi.mock('$lib/server/band/band-service', () => bandServiceMock);

const testUser = mockUser({ id: 'user-owner', name: 'Test Owner' });

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => testUser
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: unknown[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		const fn = handler as (...args: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	}
}));

beforeEach(() => {
	vi.clearAllMocks();
	bandServiceMock.getUserRole.mockResolvedValue('owner');
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { updateBand } = (await import('$lib/remote/bands.remote')) as any;

// ---------------------------------------------------------------------------
// Remote handlers
// ---------------------------------------------------------------------------

describe('updateBand', () => {
	it('updates name and bio', async () => {
		const result = await updateBand({ bandId: 'band-1', name: 'New Name', bio: 'New bio' });

		expect(bandServiceMock.update).toHaveBeenCalledWith('band-1', {
			name: 'New Name',
			bio: 'New bio'
		});
		expect(result.success).toBe(true);
	});

	it('sends null bio when empty', async () => {
		await updateBand({ bandId: 'band-1', name: 'New Name', bio: '' });

		expect(bandServiceMock.update).toHaveBeenCalledWith('band-1', {
			name: 'New Name',
			bio: ''
		});
	});

	it('rejects non-admin users', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('member');

		await expect(updateBand({ bandId: 'band-1', name: 'X', bio: '' })).rejects.toThrow();
	});

	it('allows admin users', async () => {
		bandServiceMock.getUserRole.mockResolvedValue('admin');

		const result = await updateBand({ bandId: 'band-1', name: 'New Name', bio: '' });
		expect(result.success).toBe(true);
	});
});
