import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	})
}));

// R2 is the outside service here.
vi.mock('$lib/server/storage', () => ({
	deleteObject: vi.fn().mockResolvedValue(undefined),
	uploadFile: vi.fn(async (_buffer: ArrayBuffer, key: string) => key)
}));

const { deleteObject, uploadFile } = await import('$lib/server/storage');
const {
	updateMemberProfile,
	getMemberProfileForEdit,
	updateBandProfile,
	getBandProfileForEdit,
	setUserAvatar,
	clearUserAvatar
} = await import('./profile-service');

function member(id: string, opts: { image?: string | null; memberNumber?: number } = {}) {
	sqlite
		.prepare(`insert into user (id, name, email, image, member_number) values (?, ?, ?, ?, ?)`)
		.run(id, `Name ${id}`, `${id}@example.com`, opts.image ?? null, opts.memberNumber ?? null);
}

function entry(
	id: string,
	owner: { userId?: string; groupId?: string },
	cols: Record<string, string | number | null> = {}
) {
	const names = ['id', 'user_id', 'group_id', 'name', ...Object.keys(cols)];
	sqlite
		.prepare(
			`insert into directory_entry (${names.join(', ')}) values (${names.map(() => '?').join(', ')})`
		)
		.run(id, owner.userId ?? null, owner.groupId ?? null, `Entry ${id}`, ...Object.values(cols));
}

const tag = (entryId: string, kind: string, value: string) =>
	sqlite
		.prepare(`insert into directory_tag (entry_id, kind, value) values (?, ?, ?)`)
		.run(entryId, kind, value);

const membership = (groupId: string, userId: string, role: string, status = 'active') =>
	sqlite
		.prepare(
			`insert into group_member (id, group_id, user_id, role, status) values (?, ?, ?, ?, ?)`
		)
		.run(`gm-${groupId}-${userId}`, groupId, userId, role, status);

const entryRow = (id: string) =>
	sqlite.prepare(`select * from directory_entry where id = ?`).get(id) as Record<string, unknown>;

const tags = (entryId: string) =>
	sqlite
		.prepare(`select kind, value from directory_tag where entry_id = ? order by kind, rowid`)
		.all(entryId);

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of [
		'directory_tag',
		'directory_entry',
		'group_member',
		'media_attachment',
		'media',
		'user'
	]) {
		sqlite.exec(`delete from "${t}"`);
	}
	member('user-1');
	entry('entry-1', { userId: 'user-1' });
});

describe('updateMemberProfile', () => {
	it('updates the listing and replaces instruments and genres', async () => {
		tag('entry-1', 'instrument', 'kazoo');

		await updateMemberProfile('user-1', {
			bio: 'Hello world',
			tagline: 'Musician',
			instruments: ['guitar', 'piano'],
			genres: ['rock', 'jazz']
		});

		expect(entryRow('entry-1')).toMatchObject({
			bio: 'Hello world',
			tagline: 'Musician',
			looking_for: null
		});
		expect(tags('entry-1')).toEqual([
			{ kind: 'genre', value: 'rock' },
			{ kind: 'genre', value: 'jazz' },
			{ kind: 'instrument', value: 'guitar' },
			{ kind: 'instrument', value: 'piano' }
		]);
	});

	it('saving one kind leaves the other kinds alone', async () => {
		// They share one table, so an unscoped delete would clear instruments on a genre save.
		tag('entry-1', 'instrument', 'bass');
		tag('entry-1', 'skill', 'promoter');

		await updateMemberProfile('user-1', { genres: ['jazz'] });

		expect(tags('entry-1')).toEqual([
			{ kind: 'genre', value: 'jazz' },
			{ kind: 'instrument', value: 'bass' },
			{ kind: 'skill', value: 'promoter' }
		]);
	});

	it("never touches another entry's tags", async () => {
		member('user-2');
		entry('entry-2', { userId: 'user-2' });
		tag('entry-2', 'genre', 'punk');

		await updateMemberProfile('user-1', { genres: ['jazz'] });

		expect(tags('entry-2')).toEqual([{ kind: 'genre', value: 'punk' }]);
	});

	it('writes whichever direction the member chose, and null for neither', async () => {
		for (const lookingFor of ['band', 'members', null] as const) {
			await updateMemberProfile('user-1', { lookingFor });
			expect(entryRow('entry-1').looking_for).toBe(lookingFor);
		}
	});

	it('writes the instruments a member needs under a different kind from the ones they play', async () => {
		await updateMemberProfile('user-1', {
			lookingFor: 'members',
			instruments: ['guitar'],
			seekingInstruments: ['drums']
		});

		expect(tags('entry-1')).toEqual([
			{ kind: 'instrument', value: 'guitar' },
			{ kind: 'seeking_instrument', value: 'drums' }
		]);
	});

	it('writes skills trimmed and lowercased under their own kind', async () => {
		await updateMemberProfile('user-1', { skills: ['Sound Engineer', ' photographer '] });

		expect(tags('entry-1')).toEqual([
			{ kind: 'skill', value: 'sound engineer' },
			{ kind: 'skill', value: 'photographer' }
		]);
	});

	it('truncates bio to 2000 chars and tagline to 150', async () => {
		await updateMemberProfile('user-1', { bio: 'x'.repeat(3000), tagline: 'y'.repeat(200) });

		const row = entryRow('entry-1');
		expect(row.bio).toHaveLength(2000);
		expect(row.tagline).toHaveLength(150);
	});

	it('limits instruments to 20', async () => {
		await updateMemberProfile('user-1', {
			instruments: Array.from({ length: 30 }, (_, i) => `inst-${i}`)
		});

		expect(tags('entry-1')).toHaveLength(20);
	});

	it('stores links in the validated shape', async () => {
		await updateMemberProfile('user-1', {
			links: [
				{ label: 'Website', url: 'https://example.com', extra: 'dropped' },
				{ label: 'Twitter', url: 'https://twitter.com/test' }
			] as never
		});

		expect(JSON.parse(entryRow('entry-1').links as string)).toEqual([
			{ label: 'Website', url: 'https://example.com' },
			{ label: 'Twitter', url: 'https://twitter.com/test' }
		]);
	});

	it('merges a contact update onto the contact already on the entry', async () => {
		sqlite
			.prepare(`update directory_entry set contact = ? where id = 'entry-1'`)
			.run(JSON.stringify({ email: 'old@example.com', phone: '555-0100' }));

		await updateMemberProfile('user-1', { directoryContact: { email: 'new@example.com' } });

		expect(JSON.parse(entryRow('entry-1').contact as string)).toEqual({
			email: 'new@example.com',
			phone: '555-0100'
		});
	});

	it('creates the entry from user.name when the member somehow has none', async () => {
		member('user-2');

		await updateMemberProfile('user-2', { tagline: 'New here' });

		expect(
			sqlite.prepare(`select name, tagline from directory_entry where user_id = 'user-2'`).all()
		).toEqual([{ name: 'Name user-2', tagline: 'New here' }]);
	});
});

describe('getMemberProfileForEdit', () => {
	it('returns null when the member has no entry', async () => {
		member('nobody');
		expect(await getMemberProfileForEdit('nobody')).toBeNull();
	});

	it('returns the profile with its tags split by kind, in the shape the form speaks', async () => {
		sqlite.exec(`delete from directory_entry`);
		sqlite.exec(`update user set image = 'users/avatars/a.png', member_number = 42`);
		entry('entry-1', { userId: 'user-1' }, { bio: 'Hi', tagline: 'Dev', looking_for: 'band' });
		tag('entry-1', 'instrument', 'guitar');
		tag('entry-1', 'instrument', 'drums');
		tag('entry-1', 'genre', 'rock');
		tag('entry-1', 'seeking_instrument', 'bass');
		tag('entry-1', 'skill', 'promoter');
		member('user-2');
		entry('entry-2', { userId: 'user-2' });
		tag('entry-2', 'genre', 'polka');

		const result = await getMemberProfileForEdit('user-1');

		expect(result).toMatchObject({
			bio: 'Hi',
			tagline: 'Dev',
			image: 'users/avatars/a.png',
			memberNumber: 42,
			lookingFor: 'band',
			lookingForBand: true,
			seekingInstruments: ['bass'],
			directoryVisibility: 'public',
			directoryContact: null,
			genres: ['rock'],
			skills: ['promoter']
		});
		expect([...result!.instruments].sort()).toEqual(['drums', 'guitar']);
		expect(result).not.toHaveProperty('id');
	});
});

describe('updateBandProfile', () => {
	beforeEach(() => {
		entry('band-entry', { groupId: 'band-1' });
	});

	it.each([
		['a plain member', () => membership('band-1', 'user-1', 'member')],
		['an admin who is no longer active', () => membership('band-1', 'user-1', 'admin', 'left')],
		['an admin of a different band', () => membership('band-2', 'user-1', 'admin')],
		['not in the band at all', () => undefined]
	])('refuses %s and writes nothing', async (_label, seed) => {
		seed();

		await expect(updateBandProfile('band-1', 'user-1', { tagline: 'Great band' })).rejects.toThrow(
			'Not authorized'
		);
		expect(entryRow('band-entry').tagline).toBeNull();
	});

	it('updates the band listing for an admin', async () => {
		membership('band-1', 'user-1', 'admin');

		await updateBandProfile('band-1', 'user-1', {
			tagline: 'Best band ever',
			genres: ['punk', 'ska'],
			lookingForMembers: true
		});

		expect(entryRow('band-entry')).toMatchObject({
			tagline: 'Best band ever',
			looking_for: 'members'
		});
		expect(tags('band-entry')).toEqual([
			{ kind: 'genre', value: 'punk' },
			{ kind: 'genre', value: 'ska' }
		]);
	});

	it('writes what the band is short of under its own kind', async () => {
		membership('band-1', 'user-1', 'owner');

		await updateBandProfile('band-1', 'user-1', {
			genres: ['punk'],
			seekingInstruments: ['drums']
		});

		expect(tags('band-entry')).toEqual([
			{ kind: 'genre', value: 'punk' },
			{ kind: 'seeking_instrument', value: 'drums' }
		]);
	});

	it('clears lookingFor rather than writing false', async () => {
		membership('band-1', 'user-1', 'owner');
		sqlite.exec(`update directory_entry set looking_for = 'members' where id = 'band-entry'`);

		await updateBandProfile('band-1', 'user-1', { lookingForMembers: false });

		expect(entryRow('band-entry').looking_for).toBeNull();
	});

	it('round-trips hometown and foundedYear', async () => {
		membership('band-1', 'user-1', 'owner');

		await updateBandProfile('band-1', 'user-1', {
			hometown: 'Corvallis, OR',
			foundedYear: '2019'
		});

		expect(entryRow('band-entry')).toMatchObject({
			hometown: 'Corvallis, OR',
			founded_year: '2019'
		});
	});

	it('nulls hometown and foundedYear when omitted (why the edit form must submit them)', async () => {
		membership('band-1', 'user-1', 'owner');
		sqlite.exec(
			`update directory_entry set hometown = 'Albany', founded_year = '2001' where id = 'band-entry'`
		);

		await updateBandProfile('band-1', 'user-1', { tagline: 'Only tagline' });

		expect(entryRow('band-entry')).toMatchObject({ hometown: null, founded_year: null });
	});
});

describe('setUserAvatar', () => {
	it('uploads the file and returns a cache-busting, extension-mapped key', async () => {
		const key = await setUserAvatar('user-1', new ArrayBuffer(8), 'image/png');

		// The per-upload token is what stops a replaced avatar reusing its URL.
		expect(key).toMatch(/^users\/avatars\/user-1-[0-9a-f]{8}\.png$/);
		expect(uploadFile).toHaveBeenCalledWith(expect.any(ArrayBuffer), key, 'image/png');
		expect(sqlite.prepare(`select image from user where id = 'user-1'`).get()).toEqual({
			image: key
		});
	});

	it('re-points the slot at the new object without deleting the old one', async () => {
		// Whether the previous object can be reclaimed is the sweep's question.
		const first = await setUserAvatar('user-1', new ArrayBuffer(8), 'image/png');
		const second = await setUserAvatar('user-1', new ArrayBuffer(8), 'image/webp');

		expect(
			sqlite
				.prepare(
					`select m.key from media_attachment a join media m on m.id = a.media_id
					 where a.attachable_type = 'user' and a.attachable_id = 'user-1' and a.slot = 'avatar'`
				)
				.all()
		).toEqual([{ key: second }]);
		expect(sqlite.prepare(`select key from media order by key`).all()).toEqual(
			[{ key: first }, { key: second }].sort((a, b) => a.key.localeCompare(b.key))
		);
		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('clearUserAvatar', () => {
	it('detaches the slot and clears user.image rather than deleting the object', async () => {
		await setUserAvatar('user-1', new ArrayBuffer(8), 'image/png');

		await clearUserAvatar('user-1');

		expect(sqlite.prepare(`select count(*) as n from media_attachment`).get()).toEqual({ n: 0 });
		expect(sqlite.prepare(`select count(*) as n from media`).get()).toEqual({ n: 1 });
		expect(sqlite.prepare(`select image from user where id = 'user-1'`).get()).toEqual({
			image: null
		});
		expect(deleteObject).not.toHaveBeenCalled();
	});
});

describe('getBandProfileForEdit', () => {
	it('returns null when the band has no entry', async () => {
		expect(await getBandProfileForEdit('nonexistent')).toBeNull();
	});

	it('returns the band profile in the shape the form already speaks', async () => {
		entry(
			'band-entry',
			{ groupId: 'band-1' },
			{ tagline: 'NYC punk', looking_for: 'members', visibility: 'public' }
		);
		tag('band-entry', 'genre', 'punk');
		tag('band-entry', 'genre', 'rock');
		tag('band-entry', 'seeking_instrument', 'drums');
		tag('entry-1', 'genre', 'jazz');

		const result = await getBandProfileForEdit('band-1');

		expect(result).toMatchObject({
			tagline: 'NYC punk',
			lookingForMembers: true,
			directoryVisibility: 'public',
			directoryContact: null,
			seekingInstruments: ['drums']
		});
		expect([...result!.genres].sort()).toEqual(['punk', 'rock']);
		expect(result).not.toHaveProperty('id');
	});
});
