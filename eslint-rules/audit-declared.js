/**
 * A staff `form` or `command` that changes money, a clearance, a setting, a
 * visibility or a record's existence declares its audit row: its handler is
 * wrapped in `audited`, `writesAudit` or `unaudited` from
 * `#lib/server/audit/declared.js` (#2841).
 *
 * The cheap half, one file at a time: it sees a handler that asks its
 * capability directly. `scripts/audit-coverage.spec.ts` also follows guards
 * that ask on the handler's behalf, and checks each declaration holds.
 */

/** @import { RuleNode } from './ast.js' */

const MONEY = [
	'finance.refund',
	'finance.collect',
	'reservation.comp',
	'credit.adjust',
	'credit.comp'
];

/**
 * The classes `scripts/audit-coverage.spec.ts` names, read from syntax.
 * @param {string} name
 * @param {Set<string>} caps
 * @param {string} text
 */
function classes(name, caps, text) {
	return [
		(MONEY.some((c) => caps.has(c)) || /^(comp(?!lete)|refund)/.test(name)) && 'money',
		(caps.has('volunteer.manageCertifications') || /Orientation|Certification/.test(name)) &&
			'clearance',
		caps.has('settings.update') && 'settings',
		/\bvisibility\b/i.test(text) && 'visibility',
		/^(delete|remove|purge|merge)/.test(name) && 'deletion'
	].filter(Boolean);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require a staff mutation that changes money, a clearance, a setting, a visibility or a deletion to declare its audit row.'
		},
		messages: {
			undeclared:
				"'{{name}}' changes {{classes}} and declares no audit row. Wrap its handler in audited(...), writesAudit('<action>', ...) or unaudited('<why>', ...) from #lib/server/audit/declared.js."
		}
	},
	create(context) {
		const { sourceCode } = context;
		return {
			/** @param {RuleNode} node */
			VariableDeclarator(node) {
				const call = node.init;
				if (node.id.type !== 'Identifier' || call?.type !== 'CallExpression') return;
				if (call.callee.type !== 'Identifier' || !['form', 'command'].includes(call.callee.name)) {
					return;
				}
				const handler = call.arguments.at(-1);
				if (handler?.type !== 'ArrowFunctionExpression' && handler?.type !== 'FunctionExpression') {
					return;
				}

				const caps = new Set();
				let staff = false;
				/** @param {RuleNode} n */
				const visit = (n) => {
					if (n.type === 'CallExpression' && n.callee.type === 'Identifier') {
						if (n.callee.name === 'requireCapability' || n.callee.name === 'can') staff = true;
						const [arg] = n.arguments;
						if (n.callee.name === 'requireCapability' && arg?.type === 'Literal') {
							caps.add(String(arg.value));
						}
					}
					for (const key of sourceCode.visitorKeys[n.type] ?? []) {
						const child = n[key];
						for (const c of Array.isArray(child) ? child : [child]) {
							if (c && typeof c.type === 'string') visit(c);
						}
					}
				};
				visit(handler);
				if (!staff) return;

				const found = classes(node.id.name, caps, sourceCode.getText(handler));
				if (!found.length) return;
				context.report({
					node: node.id,
					messageId: 'undeclared',
					data: { name: node.id.name, classes: found.join(', ') }
				});
			}
		};
	}
};
