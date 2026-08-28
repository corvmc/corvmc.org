import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * The single `db.select()` each handler issues — POST's sortOrder high-water
 * mark, or DELETE's attachment lookup. One variable rather than switching on
 * call order: both handlers select exactly once, so an index-based mock hands
 * DELETE the row POST was asking for and its 404 path never runs.
 */
let selectResult: unknown[] = [];
let lastSelectWhere: unknown;

function selectChain() {
	const chain: Record<string, unknown> = {};
	const step = (fn?: (a: unknown) => void) => (a: unknown) => {
		fn?.(a);
		return chain;
	};
	Object.assign(chain, {
		from: step(),
		where: step((w) => (lastSelectWhere = w)),
		limit: step(),
		then: (resolve: (v: unknown[]) => void) => resolve(selectResult)
	});
	return chain;
}

vi.mock('$lib/server/db', () => ({
	db: { select: vi.fn(() => selectChain()) }
}));

const uploadFile = vi.fn(async (_buffer: ArrayBuffer, key: string) => key);
const deleteObject = vi.fn(async (_key: string) => undefined);
vi.mock('$lib/server/storage', () => ({
	uploadFile: (buffer: ArrayBuffer, key: string) => uploadFile(buffer, key),
	deleteObject: (key: string) => deleteObject(key)
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

vi.mock('$lib/server/band/band-service', () => ({
	getUserRole: vi.fn(async () => 'owner')
}));

vi.mock('$lib/server/storage-keys', () => ({
	extensionForType: () => 'jpg'
}));

const { POST, DELETE } = await import('./+server');

const BAND = '11111111-1111-1111-1111-111111111111';
const locals = { user: { id: 'user-1' } };

function upload(type: string, files: File[], caption?: string) {
	const fd = new FormData();
	fd.set('type', type);
	if (caption) fd.set('caption', caption);
	for (const f of files) fd.append('file', f);
	return {
		params: { id: BAND },
		locals,
		request: new Request('http://x/api/bands/x/media', { method: 'POST', body: fd })
	} as never;
}

const jpeg = (name = 'a.jpg') =>
	new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [{ maxOrder: null }];
	lastSelectWhere = undefined;
	record.mockResolvedValue({ id: 'media-1' });
	attach.mockResolvedValue({ id: 'attachment-1' });
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
		selectResult = [{ maxOrder: 4 }];
		await POST(upload('image', [jpeg('a.jpg'), jpeg('b.jpg')]));
		expect(attach.mock.calls.map((c) => c[0].sortOrder)).toEqual([5, 6]);
	});

	it('never deletes an R2 object', async () => {
		await POST(upload('image', [jpeg()]));
		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('DELETE', () => {
	function del(mediaId?: string) {
		const url = new URL('http://x/api/bands/x/media');
		if (mediaId) url.searchParams.set('mediaId', mediaId);
		return { params: { id: BAND }, locals, url } as never;
	}

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
