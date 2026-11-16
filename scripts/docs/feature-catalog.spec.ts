import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEATURES_DIR, readCatalog, renderCatalog } from './feature-catalog.mjs';

let root: string;

function write(path: string, text: string) {
	const full = join(root, path);
	mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
	writeFileSync(full, text);
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'features-'));
	write('staff/README.md', '# Staff panel\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('feature catalog', () => {
	it('renders one sorted row per file, with pipes escaped', () => {
		write('staff/b.md', '# Beta\n\nStatus: ✅ /staff/b\n\nNotes with a | pipe.\n');
		write('staff/a.md', '# Alpha\n\nStatus: ✅ Built\n');
		const { sections, errors } = readCatalog(root);
		expect(errors).toEqual([]);
		const rows = renderCatalog(sections)
			.split('\n')
			.filter((l) => l.startsWith('| ') && !l.startsWith('| Feature') && !l.startsWith('| ---'));
		expect(rows).toEqual([
			'| Alpha | ✅ Built |  |',
			'| Beta | ✅ /staff/b | Notes with a \\| pipe. |'
		]);
	});

	it('rejects notes that would not fit one table cell', () => {
		write('staff/a.md', '# Alpha\n\nStatus: ✅\n\nOne.\n\nTwo.\n');
		expect(readCatalog(root).errors).toHaveLength(1);
	});

	it('rejects a file without its heading or status line', () => {
		write('staff/a.md', 'Alpha\n\nnotes\n');
		expect(readCatalog(root).errors).toHaveLength(2);
	});

	it('rejects a folder that is not a panel, and the same name twice in one panel', () => {
		write('settings/a.md', '# Alpha\n\nStatus: ✅\n');
		write('staff/a.md', '# Alpha\n\nStatus: ✅\n');
		write('staff/alpha-2.md', '# alpha\n\nStatus: ✅\n');
		expect(readCatalog(root).errors).toHaveLength(2);
	});

	// The committed tree is what `pnpm docs:check` reads; an invalid file there fails CI anyway,
	// but here it fails next to the format it broke.
	it('parses every committed feature', () => {
		const { sections, errors } = readCatalog(FEATURES_DIR);
		expect(errors).toEqual([]);
		expect(sections.map((s) => s.dir)).toEqual(['staff', 'member', 'band', 'public', 'api']);
	});
});
