import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * The `db.select()` calls the handlers issue — POST's slot stats, or DELETE's
 * attachment lookup. One variable rather than switching on
 * call order: both handlers select exactly once, so an index-based mock hands
 * DELETE the row POST was asking for and its 404 path never runs.
 */
let selectResult: unknown[] = [];
let lastSelectWhere: unknown;
/**
 * What the tier lookup answers with. Kept apart from `selectResult` because a
 * gallery upload now selects twice — the slot's count and high-water mark from
 * `media_attachment`, then the band's tier from `band_site` — and one shared
 * result would hand the tier query a row of sort orders. Which table a chain is
 * reading is decided by the argument to `from`, so the two never cross.
 */
let tierResult: unknown[] = [{ tier: 'free' }];

function selectChain() {
	const chain: Record<string, unknown> = {};
	let table: unknown;
	const step = (fn?: (a: unknown) => void) => (a: unknown) => {
		fn?.(a);
		return chain;
	};
	Object.assign(chain, {
		from: step((t) => (table = t)),
		where: step((w) => (lastSelectWhere = w)),
		limit: step(),
		then: (resolve: (v: unknown[]) => void) =>
			resolve(table === bandSite ? tierResult : selectResult)
	});
	return chain;
}

import { bandSite } from '$lib/server/db/schema/band-site';

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(() => selectChain()) }
}));

const uploadFile = vi.fn(async (_buffer: ArrayBuffer, key: string) => key);
const deleteObject = vi.fn(async (_key: string) => undefined);
vi.mock('$lib/server/storage', () => ({
	uploadFile: (buffer: ArrayBuffer, key: string) => uploadFile(buffer, key),
	deleteObject: (key: string) => deleteObject(key),
	// POST returns the public URL beside the key so the page editor can draw an
	// upload in its canvas without a round trip.
	resolveImageUrl: (key: string) => `https://cdn.test/${key}`
}));

/**
 * Typed by their argument, not as bare `vi.fn()` — the assertions below read
 * `attach.mock.calls[0][0]`, which on a zero-arg mock is a `[]` tuple with no
 * index 0 and fails `svelte-check` even though the test passes at runtime.
 */
type RecordArgs = { key: string; contentType: string; byteSize: number };
type AttachArgs = { mediaId: string; attachableId: string; slot: string; sortOrder: number };

const record = vi.fn(async (_input: RecordArgs) => ({ id: 'media-1' }));
const attach = vi.fn(async (_input: AttachArgs) => ({ id: 'attachment-1' }));
const detach = vi.fn(async (_attachmentId: string) => undefined);
vi.mock('$lib/server/media/media-service', () => ({
	record: (input: RecordArgs) => record(input),
	attach: (input: AttachArgs) => attach(input),
	detach: (id: string) => detach(id)
}));

/**
 * The endpoint's 401, its band-existence 404 and its role check are one call to
 * `requireGroupRole({ id }, 'admin')` since phase 4. What that guard *does* is
 * `group-context.spec.ts`'s subject; what this file owes is that the endpoint
 * calls it, with the right ref, before touching anything — asserted below.
 */
const requireGroupRole = vi.fn(async (_ref: unknown, _minRole: unknown) => ({
	user: { id: 'user-1' },
	group: { id: '11111111-1111-1111-1111-111111111111' },
	role: 'owner' as const
}));
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (ref: unknown, minRole: unknown) => requireGroupRole(ref, minRole)
}));

vi.mock('$lib/server/storage-keys', () => ({
	extensionForType: () => 'jpg'
}));

const { POST, DELETE } = await import('./+server');

const BAND = '11111111-1111-1111-1111-111111111111';

function upload(type: string, files: File[], caption?: string) {
	const fd = new FormData();
	fd.set('type', type);
	if (caption) fd.set('caption', caption);
	for (const f of files) fd.append('file', f);
	return {
		params: { id: BAND },
		request: new Request('http://x/api/bands/x/media', { method: 'POST', body: fd })
	} as never;
}

const jpeg = (name = 'a.jpg') =>
	new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

function del(mediaId?: string) {
	const url = new URL('http://x/api/bands/x/media');
	if (mediaId) url.searchParams.set('mediaId', mediaId);
	return { params: { id: BAND }, url } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [{ maxOrder: null, used: 0 }];
	tierResult = [{ tier: 'free' }];
	lastSelectWhere = undefined;
	record.mockResolvedValue({ id: 'media-1' });
	attach.mockResolvedValue({ id: 'attachment-1' });
	requireGroupRole.mockResolvedValue({
		user: { id: 'user-1' },
		group: { id: BAND },
		role: 'owner' as const
	});
});

// ---------------------------------------------------------------------------

describe('the guard', () => {
	it.each([
		['POST', () => POST(upload('image', [jpeg()]))],
		['DELETE', () => DELETE(del('attachment-1'))]
	])('%s requires admin of the band named by the route param', async (_name, call) => {
		selectResult = [{ id: 'attachment-1', maxOrder: null }];
		await call();
		expect(requireGroupRole).toHaveBeenCalledWith({ id: BAND }, 'admin');
	});

	it.each([
		['POST', () => POST(upload('image', [jpeg()]))],
		['DELETE', () => DELETE(del('attachment-1'))]
	])('%s does no work when the guard rejects', async (_name, call) => {
		requireGroupRole.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
		await expect(call()).rejects.toMatchObject({ status: 403 });
		expect(record).not.toHaveBeenCalled();
		expect(attach).not.toHaveBeenCalled();
		expect(detach).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------

describe('POST', () => {
	it('records the object and attaches it to the band', async () => {
		await POST(upload('image', [jpeg()], 'On stage'));

		expect(record).toHaveBeenCalledWith(
			expect.objectContaining({
				contentType: 'image/jpeg',
				byteSize: 3,
				filename: 'a.jpg',
				caption: 'On stage',
				uploadedByUserId: 'user-1'
			})
		);
		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({
				mediaId: 'media-1',
				attachableType: 'group',
				attachableId: BAND,
				slot: 'gallery'
			})
		);
	});

	it("maps the request's 'image' onto the 'gallery' slot", async () => {
		// The API vocabulary is band_media's; the tables renamed it on the way in.
		// Getting this wrong puts uploads in a slot the microsite never reads.
		await POST(upload('image', [jpeg()]));
		expect(attach.mock.calls[0][0]).toMatchObject({ slot: 'gallery' });
	});

	it('passes the other three types through unchanged', async () => {
		for (const type of ['hero', 'rider', 'stage_plot']) {
			vi.clearAllMocks();
			selectResult = [{ maxOrder: null }];
			record.mockResolvedValue({ id: 'media-1' });
			attach.mockResolvedValue({ id: 'attachment-1' });
			await POST(upload(type, [jpeg()]));
			expect(attach.mock.calls[0][0]).toMatchObject({ slot: type });
		}
	});

	it('returns the attachment id, which is what DELETE takes', async () => {
		// It used to return the uuid embedded in the R2 key — a different value
		// from any row id, so a caller feeding it back got a 404.
		const res = await POST(upload('image', [jpeg()]));
		const body = (await res.json()) as { media: { id: string }[] };
		expect(body.media[0].id).toBe('attachment-1');
	});

	it('numbers a multi-file upload from the existing high-water mark', async () => {
		// Premium, because two photos at once is past the free allowance — see the
		// cap tests below.
		tierResult = [{ tier: 'premium' }];
		selectResult = [{ maxOrder: 4, used: 5 }];
		await POST(upload('image', [jpeg('a.jpg'), jpeg('b.jpg')]));
		expect(attach.mock.calls.map((c) => c[0].sortOrder)).toEqual([5, 6]);
	});

	describe('the press-photo allowance', () => {
		it('lets a free act add its first photo', async () => {
			tierResult = [{ tier: 'free' }];
			selectResult = [{ maxOrder: null, used: 0 }];
			const res = await POST(upload('image', [jpeg()]));
			expect(res.status).toBe(200);
		});

		it('refuses a free act a second one, and says what lifts it', async () => {
			tierResult = [{ tier: 'free' }];
			selectResult = [{ maxOrder: 0, used: 1 }];
			await expect(POST(upload('image', [jpeg()]))).rejects.toMatchObject({ status: 403 });
			expect(attach).not.toHaveBeenCalled();
		});

		it('counts the whole batch, not one file at a time', async () => {
			// Two files against an empty gallery is still over a limit of one, and
			// checking per-file would let the first through and strand a half-done
			// upload.
			tierResult = [{ tier: 'free' }];
			selectResult = [{ maxOrder: null, used: 0 }];
			await expect(POST(upload('image', [jpeg('a.jpg'), jpeg('b.jpg')]))).rejects.toMatchObject({
				status: 403
			});
		});

		it('does not cap a premium act', async () => {
			tierResult = [{ tier: 'premium' }];
			selectResult = [{ maxOrder: 40, used: 41 }];
			const res = await POST(upload('image', [jpeg()]));
			expect(res.status).toBe(200);
		});

		it('treats a band with no site row as free rather than erroring', async () => {
			// The only way to reach this is a band created before its `band_site`
			// row was. The honest answer is the free allowance, not a 500 on a
			// photo upload.
			tierResult = [];
			selectResult = [{ maxOrder: null, used: 0 }];
			const res = await POST(upload('image', [jpeg()]));
			expect(res.status).toBe(200);
		});

		it('never caps a rider or a stage plot — a venue asks for those', async () => {
			tierResult = [{ tier: 'free' }];
			selectResult = [{ maxOrder: 0, used: 1 }];
			for (const type of ['rider', 'stage_plot']) {
				vi.clearAllMocks();
				record.mockResolvedValue({ id: 'media-1' });
				attach.mockResolvedValue({ id: 'attachment-1' });
				const res = await POST(upload(type, [jpeg()]));
				expect(res.status).toBe(200);
			}
		});
	});

	it('never deletes an R2 object', async () => {
		await POST(upload('image', [jpeg()]));
		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('DELETE', () => {
	it('detaches and never deletes the R2 object', async () => {
		// The rule the media layer exists to hold: another slot or another band
		// may still point at the object, and only the sweep can see that.
		selectResult = [{ id: 'attachment-1' }];

		await DELETE(del('attachment-1'));

		expect(detach).toHaveBeenCalledWith('attachment-1');
		expect(deleteObject).not.toHaveBeenCalled();
	});

	it('scopes the lookup to this band', async () => {
		selectResult = [{ id: 'attachment-1' }];
		await DELETE(del('attachment-1'));

		const names: string[] = [];
		const visit = (n: unknown) => {
			if (!n || typeof n !== 'object') return;
			const o = n as Record<string, unknown>;
			if (typeof o.name === 'string' && o.table) names.push(o.name);
			for (const k of ['queryChunks', 'left', 'right', 'value']) {
				const c = o[k];
				if (Array.isArray(c)) c.forEach(visit);
				else if (c) visit(c);
			}
		};
		visit(lastSelectWhere);

		// Without attachable_id in the predicate, an id belonging to another
		// group's media could be detached by passing it here.
		expect(names).toContain('attachable_id');
		expect(names).toContain('attachable_type');
	});

	it('404s an id this band does not own, without detaching', async () => {
		selectResult = [];
		await expect(DELETE(del('someone-elses'))).rejects.toMatchObject({ status: 404 });
		expect(detach).not.toHaveBeenCalled();
	});

	it('rejects a request with no mediaId', async () => {
		await expect(DELETE(del())).rejects.toMatchObject({ status: 400 });
	});
});
