/**
 * The shape of a drizzle-kit v1 snapshot (`migrations/<name>/snapshot.json`).
 *
 * Hand-written because drizzle-kit does not publish it: the `ddl` key is a flat
 * entity list discriminated on `entityType`, and every migration tool in
 * `scripts/db/` reads it. Declared once here so the `.mjs` helpers can point
 * JSDoc at it rather than each re-deriving the fields from a sample file.
 *
 * Fields are the ones this repo actually reads. Drizzle emits more (`origin`,
 * `nameExplicit`, `generated`); adding one here is safe, and leaving one out
 * only means nothing reads it yet.
 */

export interface SnapshotTable {
	entityType: 'tables';
	name: string;
}

export interface SnapshotColumn {
	entityType: 'columns';
	table: string;
	name: string;
	type: string;
	notNull: boolean;
	/** Drizzle always emits these two; `renderColumn` guards both, so a fixture need not. */
	autoincrement?: boolean;
	default?: string | number | null;
}

export interface SnapshotPk {
	entityType: 'pks';
	table: string;
	name: string;
	columns: string[];
}

export interface SnapshotFk {
	entityType: 'fks';
	table: string;
	name: string;
	columns: string[];
	tableTo: string;
	columnsTo: string[];
	onDelete: string | null;
	onUpdate: string | null;
}

export interface SnapshotUnique {
	entityType: 'uniques';
	table: string;
	name: string;
	columns: string[];
}

export interface SnapshotCheck {
	entityType: 'checks';
	table: string;
	name: string;
	value: string;
}

export interface SnapshotIndex {
	entityType: 'indexes';
	table: string;
	name: string;
	columns: { value: string; isExpression: boolean }[];
	isUnique: boolean;
	where: string | null;
}

export type SnapshotEntity =
	| SnapshotTable
	| SnapshotColumn
	| SnapshotPk
	| SnapshotFk
	| SnapshotUnique
	| SnapshotCheck
	| SnapshotIndex;

/** A snapshot as it sits on disk. */
export interface Snapshot {
	ddl: SnapshotEntity[];
}

/** What `readSnapshot()` turns that flat list into: tables, and per-table maps. */
export interface GroupedSnapshot {
	tables: string[];
	columns: Map<string, SnapshotColumn[]>;
	pks: Map<string, SnapshotPk[]>;
	fks: Map<string, SnapshotFk[]>;
	uniques: Map<string, SnapshotUnique[]>;
	checks: Map<string, SnapshotCheck[]>;
	indexes: Map<string, SnapshotIndex[]>;
}

/** Parent table -> its direct child tables, as `childGraph()` builds it. */
export type ChildGraph = Map<string, Set<string>>;
