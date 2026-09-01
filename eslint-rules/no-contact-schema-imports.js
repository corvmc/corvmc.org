/**
 * `contact` holds the private booking details of people who are not CMC members
 * — a manager's phone number, a settlement reference, notes about a night that
 * went wrong. `directory_entry` is a public listing; this is its opposite, and
 * the two deliberately do not share a row.
 *
 * A separate table is the protection that actually works, because this codebase
 * uses `select()` with no arguments and `getTableColumns()` splats: a private
 * column sitting on a row a public query touches is one refactor away from being
 * serialized. Putting the fields in their own table makes leaking require an
 * explicit JOIN — something a person has to mean. This rule is what keeps that
 * true, by making the JOIN impossible to write anywhere but the one module that
 * guards it.
 *
 * `contact-service.ts` is that module. Every export in it calls `requireStaff()`
 * itself rather than trusting its caller, so the guard travels with the data.
 *
 * **Why this matches the symbol and not just the module path.** The table has to
 * be re-exported from `schema/index.ts` or `drizzle-kit` cannot see it and
 * generates no migration for it. So banning the path alone would leave
 * `import { contact } from '$lib/server/db/schema'` wide open. The check is on
 * the imported *name*, from any schema module.
 */

/** The one module allowed to reach the table, plus the files that define it. */
const ALLOWED = [
	'src/lib/server/directory/contact-service.ts',
	'src/lib/server/db/schema/contact.ts',
	'src/lib/server/db/schema/index.ts'
];

/** Symbols that are the table or describe its shape. */
const GUARDED = new Set(['contact', 'contactSources', 'Contact', 'ContactSource']);

const SCHEMA_SOURCE = /^[$.].*\/db\/schema(\/|$)|^\.\.?\/schema(\/|$)|\/schema\/contact$/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Only contact-service.ts may import the `contact` schema. Every other reader goes through that service, which guards with requireStaff() itself.'
		},
		messages: {
			contactImport:
				"'{{name}}' is the private contact table. Import from '$lib/server/directory/contact-service' instead — it is the one access path, and it calls requireStaff() itself so the guard travels with the data."
		}
	},
	create(context) {
		const filename = (context.filename ?? context.getFilename()).replaceAll('\\', '/');
		if (ALLOWED.some((allowed) => filename.endsWith(allowed))) return {};

		return {
			ImportDeclaration(node) {
				const source = node.source.value;
				if (typeof source !== 'string' || !SCHEMA_SOURCE.test(source)) return;

				for (const spec of node.specifiers) {
					const name =
						spec.type === 'ImportSpecifier' ? (spec.imported.name ?? spec.imported.value) : null;
					if (name && GUARDED.has(name)) {
						context.report({ node: spec, messageId: 'contactImport', data: { name } });
					}
				}
			}
		};
	}
};
