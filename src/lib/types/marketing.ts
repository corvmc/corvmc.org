// Re-export marketing domain types so consumers don't import from the DB
// schema directly. The canonical definition lives next to the column that
// uses it in `#lib/server/db/schema/marketing.js`.
export type { SuppressionReason } from '#lib/server/db/schema/marketing.js';
