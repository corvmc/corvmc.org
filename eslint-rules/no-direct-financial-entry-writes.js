/**
 * `financial_entry` has one writer and no editor.
 *
 * Two invariants, and neither survives on convention. **Append-only**: a
 * correction is a reversing entry, so a January refund does not retroactively
 * change November — an `.update()` or `.delete()` is wrong from anywhere,
 * including inside the finance module. **One door**: an `.insert()` belongs to
 * `src/lib/server/finance/`, where the chart of accounts lives, so a new
 * transaction cannot invent its own `kind` and `category` at a call site.
 *
 * Reads are deliberately unrestricted. `annual-report-service.ts`, the CSV
 * export and `settlement-service.ts` all select from the table, and the point
 * of an accounting layer is that anything may read it.
 *
 * This is the fence, not the forcing function. `money-map.spec.ts` is what
 * notices a money column nobody accounted for; this only stops the entry being
 * written somewhere the map cannot see.
 */

/**
 * Where an entry may be inserted. Updates and deletes are allowed nowhere.
 *
 * A `.spec.ts` is on the list because a fixture is not a transaction: seeding
 * a pool balance into an in-memory SQLite is describing a sale that already
 * happened, not recording one. `act-payout.spec.ts` does exactly that.
 */
const MAY_INSERT = ['src/lib/server/finance/', 'scripts/seed/'];
const isFixture = (file) => file.endsWith('.spec.ts');

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'financial_entry is append-only and written only by the finance module. Reads are unrestricted.'
		},
		messages: {
			mutate:
				'financial_entry is append-only: {{method}}() on it would rewrite history. A correction is a reversing entry — record the opposite amount with recordEntries().',
			insert:
				'Only src/lib/server/finance/ writes financial_entry, so the chart of accounts stays in one place. Add a writer there and call it, and classify the column in money-map.ts.'
		}
	},
	create(context) {
		const filename = context.filename.replaceAll('\\', '/');
		const mayInsert = isFixture(filename) || MAY_INSERT.some((dir) => filename.includes(dir));

		return {
			CallExpression(node) {
				const callee = node.callee;
				if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;

				const method = callee.property.name;
				if (method !== 'insert' && method !== 'update' && method !== 'delete') return;

				const [arg] = node.arguments;
				if (!arg || arg.type !== 'Identifier' || arg.name !== 'financialEntry') return;

				if (method === 'insert') {
					if (!mayInsert) context.report({ node, messageId: 'insert' });
					return;
				}
				context.report({ node, messageId: 'mutate', data: { method } });
			}
		};
	}
};
