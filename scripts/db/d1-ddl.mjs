// Renders CREATE TABLE / CREATE INDEX statements from a drizzle-kit snapshot
// (`migrations/<name>/snapshot.json`, the v1 `ddl` entity-list format).
//
// This exists so `d1-safe-rebuild.mjs` can rebuild a table that is *not* itself
// changing — a cascade child that has to be temporarily detached. Drizzle only
// emits DDL for tables it is changing, so the DDL for those children has to be
// reconstructed from the snapshot, which is drizzle's own source of truth.
//
// Output deliberately mirrors drizzle-kit's own formatting (backtick quoting,
// `DEFAULT` before `NOT NULL`, constraints after columns) so a rewritten
// migration reads like the generated ones around it.

/** @typedef {import('./snapshot-types.js').Snapshot} Snapshot */
/** @typedef {import('./snapshot-types.js').GroupedSnapshot} GroupedSnapshot */
/** @typedef {import('./snapshot-types.js').SnapshotEntity} SnapshotEntity */
/** @typedef {import('./snapshot-types.js').ChildGraph} ChildGraph */

/** @param {string} s */
const q = (s) => `\`${s}\``;

/**
 * Group a snapshot's flat entity list into a per-table shape.
 *
 * @param {Snapshot} snapshot
 * @returns {GroupedSnapshot}
 */
export function readSnapshot(snapshot) {
	/** @param {SnapshotEntity['entityType']} t */
	const byType = (t) => snapshot.ddl.filter((e) => e.entityType === t);
	/** @template {{ table: string }} E @param {E[]} entities @returns {Map<string, E[]>} */
	const group = (entities) => {
		/** @type {Map<string, E[]>} */
		const m = new Map();
		for (const e of entities) {
			const bucket = m.get(e.table) ?? [];
			bucket.push(e);
			m.set(e.table, bucket);
		}
		return m;
	};
	return {
		tables: /** @type {import('./snapshot-types.js').SnapshotTable[]} */ (byType('tables')).map(
			(t) => t.name
		),
		columns: group(
			/** @type {import('./snapshot-types.js').SnapshotColumn[]} */ (byType('columns'))
		),
		pks: group(/** @type {import('./snapshot-types.js').SnapshotPk[]} */ (byType('pks'))),
		fks: group(/** @type {import('./snapshot-types.js').SnapshotFk[]} */ (byType('fks'))),
		uniques: group(
			/** @type {import('./snapshot-types.js').SnapshotUnique[]} */ (byType('uniques'))
		),
		checks: group(/** @type {import('./snapshot-types.js').SnapshotCheck[]} */ (byType('checks'))),
		indexes: group(/** @type {import('./snapshot-types.js').SnapshotIndex[]} */ (byType('indexes')))
	};
}

/**
 * Parent table -> direct child tables, from every foreign key in the snapshot.
 * Self-references are skipped: a table is not its own cascade child, and
 * including it would make the descendant walk non-terminating in spirit even
 * though the `seen` set stops it in practice.
 */
/**
 * @param {GroupedSnapshot} snap
 * @returns {ChildGraph}
 */
export function childGraph(snap) {
	/** @type {ChildGraph} */
	const kids = new Map();
	for (const [table, fks] of snap.fks) {
		for (const fk of fks) {
			if (fk.tableTo === table) continue;
			const bucket = kids.get(fk.tableTo) ?? new Set();
			bucket.add(table);
			kids.set(fk.tableTo, bucket);
		}
	}
	return kids;
}

/**
 * Every table that would be touched by an FK action if `root` were dropped,
 * deepest-first.
 *
 * Order matters and is the whole point: detaching a child means dropping it,
 * which fires actions on *its* children, so the deepest descendants have to be
 * detached before the ones above them. Reattaching runs in the exact reverse.
 */
/**
 * @param {string} root
 * @param {ChildGraph} kids
 * @returns {string[]}
 */
export function descendantsDeepestFirst(root, kids) {
	/** @type {string[]} */
	const out = [];
	const seen = new Set([root]);
	/** @param {string} table @returns {void} */
	const visit = (table) => {
		for (const child of kids.get(table) ?? []) {
			if (seen.has(child)) continue;
			seen.add(child);
			visit(child);
			out.push(child);
		}
	};
	visit(root);
	return out;
}

/**
 * @param {import('./snapshot-types.js').SnapshotColumn} col
 * @param {string | null} singlePk
 */
function renderColumn(col, singlePk) {
	let s = `\t${q(col.name)} ${col.type}`;
	if (singlePk === col.name) s += ' PRIMARY KEY';
	if (col.autoincrement) s += ' AUTOINCREMENT';
	if (col.default !== null && col.default !== undefined) s += ` DEFAULT ${col.default}`;
	if (col.notNull) s += ' NOT NULL';
	return s;
}

/**
 * @param {import('./snapshot-types.js').SnapshotFk} fk
 * @param {Set<string>} demote
 */
function renderFk(fk, demote) {
	const cols = fk.columns.map(q).join(', ');
	const colsTo = fk.columnsTo.map(q).join(', ');
	// `demote` is the set of parent tables about to be dropped. Their FK actions
	// become NO ACTION so the drop cascades nothing; every other FK on the same
	// child is left exactly as it was.
	const onDelete = demote.has(fk.tableTo) ? 'NO ACTION' : fk.onDelete;
	let s = `\tCONSTRAINT ${q(fk.name)} FOREIGN KEY (${cols}) REFERENCES ${q(fk.tableTo)}(${colsTo})`;
	if (onDelete && onDelete !== 'NO ACTION') s += ` ON DELETE ${onDelete}`;
	if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') s += ` ON UPDATE ${fk.onUpdate}`;
	return s;
}

/**
 * CREATE TABLE for `table`, optionally renamed and with FK actions demoted.
 *
 * @param {GroupedSnapshot} snap grouped snapshot from readSnapshot()
 * @param {string} table       table to render
 * @param {object} [opts]
 * @param {string} [opts.as]   emit under a different name (e.g. `__detach_x`)
 * @param {Set<string>} [opts.demote] parent tables whose FK actions become NO ACTION
 */
export function renderCreateTable(snap, table, opts = {}) {
	const { as = table, demote = new Set() } = opts;
	const columns = snap.columns.get(table) ?? [];
	const pk = (snap.pks.get(table) ?? [])[0];
	// SQLite only accepts inline PRIMARY KEY for a single column; composite keys
	// have to be a table constraint.
	const singlePk = pk && pk.columns.length === 1 ? pk.columns[0] : null;

	const parts = columns.map((c) => renderColumn(c, singlePk));
	if (pk && !singlePk) {
		parts.push(`\tCONSTRAINT ${q(pk.name)} PRIMARY KEY(${pk.columns.map(q).join(', ')})`);
	}
	for (const u of snap.uniques.get(table) ?? []) {
		parts.push(`\tCONSTRAINT ${q(u.name)} UNIQUE(${u.columns.map(q).join(',')})`);
	}
	for (const fk of snap.fks.get(table) ?? []) parts.push(renderFk(fk, demote));
	for (const c of snap.checks.get(table) ?? []) {
		parts.push(`\tCONSTRAINT ${q(c.name)} CHECK(${c.value})`);
	}
	return `CREATE TABLE ${q(as)} (\n${parts.join(',\n')}\n);`;
}

/**
 * Indexes for a table. Dropping a table drops its indexes, so any rebuild has
 * to put them back. Unique constraints declared as `uniques` are part of the
 * CREATE TABLE above; these are the standalone CREATE INDEX statements.
 */
/**
 * @param {GroupedSnapshot} snap
 * @param {string} table
 */
export function renderIndexes(snap, table) {
	return (snap.indexes.get(table) ?? []).map((idx) => {
		const cols = idx.columns.map((c) => (c.isExpression ? c.value : q(c.value))).join(',');
		const unique = idx.isUnique ? 'UNIQUE INDEX' : 'INDEX';
		const where = idx.where ? ` WHERE ${idx.where}` : '';
		return `CREATE ${unique} ${q(idx.name)} ON ${q(table)} (${cols})${where};`;
	});
}

/**
 * Column list shared by a table and its rebuild copy.
 *
 * @param {GroupedSnapshot} snap
 * @param {string} table
 */
export function columnList(snap, table) {
	return (snap.columns.get(table) ?? []).map((c) => q(c.name)).join(', ');
}
