/**
 * Driver text — "UNIQUE constraint failed", "SQLITE_…", "D1_ERROR" — is matched
 * only in `src/lib/server/db/constraint-errors.ts`. On D1 drizzle wraps a single
 * statement's error so its message is the SQL and the driver text is on
 * `cause`; a check reading `err.message` alone never matches there (#2704).
 */
const DRIVER_TEXT = /constraint|SQLITE_|D1_ERROR/i;
const STRING_MATCHERS = new Set([
	'includes',
	'startsWith',
	'endsWith',
	'indexOf',
	'match',
	'search'
]);

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Match driver error text only through constraint-errors.ts.' },
		messages: {
			driverText:
				'Driver text sits on the error’s cause on D1. Use isUniqueConstraintError or ' +
				'isForeignKeyConstraintError from #lib/server/db/constraint-errors.js.'
		}
	},
	create(context) {
		const isDriverString = (node) =>
			node?.type === 'Literal' && typeof node.value === 'string' && DRIVER_TEXT.test(node.value);

		return {
			Literal(node) {
				if (node.regex && DRIVER_TEXT.test(node.regex.pattern)) {
					context.report({ node, messageId: 'driverText' });
				}
			},
			'NewExpression, CallExpression'(node) {
				const callee = node.callee;
				const named =
					callee.type === 'Identifier'
						? callee.name
						: callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
							? callee.property.name
							: null;
				if (
					named !== 'RegExp' &&
					!(callee.type === 'MemberExpression' && STRING_MATCHERS.has(named))
				)
					return;
				if (isDriverString(node.arguments[0])) {
					context.report({ node: node.arguments[0], messageId: 'driverText' });
				}
			}
		};
	}
};
