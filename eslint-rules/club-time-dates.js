/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * Dates render in club time. A `toLocale*String` with no `timeZone` formats in
 * the runtime's zone — UTC during SSR on Workers, the viewer's zone after
 * hydration — and `toISOString().slice(0, 10)` is the UTC calendar day. Both
 * show the wrong day for part of every day. `new Date(\`${date}T${time}\`)` with
 * no `Z` or offset is the same mistake in reverse: it reads a wall clock in the
 * runtime's zone.
 */

const DATE_KEYS = new Set([
	'dateStyle',
	'timeStyle',
	'weekday',
	'era',
	'year',
	'month',
	'day',
	'hour',
	'minute',
	'second'
]);

/** The options argument's static property names, or null when it cannot be read. */
function optionKeys(/** @type {RuleNode | undefined} */ options) {
	if (!options) return new Set();
	if (options.type !== 'ObjectExpression') return null;
	const keys = new Set();
	for (const p of options.properties) {
		if (p.type !== 'Property') return null;
		const name = p.key?.type === 'Identifier' ? p.key.name : p.key?.value;
		if (typeof name !== 'string') return null;
		keys.add(name);
	}
	return keys;
}

function isNewDate(/** @type {RuleNode} */ node) {
	return node?.type === 'NewExpression' && node.callee?.name === 'Date';
}

/** True when the type checker (if this file has one) says the receiver is a Date. */
function hasDateType(
	/** @type {import('eslint').Rule.RuleContext} */ context,
	/** @type {RuleNode} */ node
) {
	const services = context.sourceCode.parserServices;
	if (!services?.program || !services.esTreeNodeToTSNodeMap) return false;
	const checker = services.program.getTypeChecker();
	const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
	const parts = type.isUnion() ? type.types : [type];
	return parts.some(
		(/** @type {import('typescript').Type} */ t) => t.getSymbol()?.getName() === 'Date'
	);
}

function isNumberLiteral(/** @type {RuleNode} */ node, /** @type {number} */ value) {
	return node?.type === 'Literal' && node.value === value;
}

/** `x.toISOString()` followed by `.slice(0, 10)`, `.substring(0, 10)` or `.split('T')`. */
function isIsoDateSlice(/** @type {RuleNode} */ call) {
	const callee = call.callee;
	if (callee?.type !== 'MemberExpression') return false;
	const inner = callee.object;
	if (inner?.type !== 'CallExpression') return false;
	if (inner.callee?.type !== 'MemberExpression') return false;
	if (inner.callee.property?.name !== 'toISOString') return false;
	const method = callee.property?.name;
	const [a, b] = call.arguments ?? [];
	if (method === 'slice' || method === 'substring') {
		return isNumberLiteral(a, 0) && isNumberLiteral(b, 10);
	}
	return method === 'split' && a?.type === 'Literal' && a.value === 'T';
}

/**
 * The static text of a template literal or a `+` chain of strings, or null.
 * @param {RuleNode} node
 * @returns {string[] | null}
 */
function staticParts(node) {
	if (node?.type === 'TemplateLiteral') {
		return node.quasis.map((/** @type {RuleNode} */ q) => String(q.value?.cooked ?? ''));
	}
	if (node?.type === 'BinaryExpression' && node.operator === '+') {
		const left = staticParts(node.left) ?? [''];
		const right = staticParts(node.right) ?? [''];
		return [...left, ...right];
	}
	if (node?.type === 'Literal' && typeof node.value === 'string') return [node.value];
	return null;
}

/** `new Date(<built string>)` whose text has a `T…` time and ends without a zone. */
function isZonelessDateTime(/** @type {RuleNode} */ node) {
	if (!isNewDate(node) || node.arguments?.length !== 1) return false;
	const arg = node.arguments[0];
	if (arg.type !== 'TemplateLiteral' && arg.type !== 'BinaryExpression') return false;
	const parts = staticParts(arg);
	if (!parts || !parts.some((p) => /T(\d|$)/.test(p))) return false;
	return !/(Z|[+-]\d{2}:?\d{2})$/.test(parts.at(-1) ?? '');
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Require club-time dates in templates and remotes.' },
		schema: [],
		messages: {
			noTimeZone:
				'`{{method}}` without a `timeZone` renders in UTC on the server and the viewer zone in the browser. Use a formatter from $lib/utils/format (formatDateShortYear, formatHistoryTime, …).',
			isoSlice:
				'`toISOString()` gives the UTC calendar day. Use clubToday() / toLocalDate() for an instant, addIsoDays() for date arithmetic, or utcCalendarDate() for a stored date-only value.',
			zonelessDateTime:
				"A date and time with no `Z` or offset is read in the runtime zone — the viewer's in the browser. Use clubInstant(date, time) from $lib/utils/format."
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			NewExpression(node) {
				if (isZonelessDateTime(node)) context.report({ node, messageId: 'zonelessDateTime' });
			},
			/** @param {RuleNode} node */
			CallExpression(node) {
				if (isIsoDateSlice(node)) {
					context.report({ node, messageId: 'isoSlice' });
					return;
				}
				const callee = node.callee;
				if (callee?.type !== 'MemberExpression' || callee.computed) return;
				const method = callee.property?.name;
				if (
					method !== 'toLocaleDateString' &&
					method !== 'toLocaleTimeString' &&
					method !== 'toLocaleString'
				) {
					return;
				}
				const keys = optionKeys(node.arguments?.[1]);
				if (keys === null || keys.has('timeZone')) return;
				if (method === 'toLocaleString') {
					const dateLike =
						isNewDate(callee.object) ||
						[...keys].some((k) => DATE_KEYS.has(k)) ||
						hasDateType(context, callee.object);
					if (!dateLike) return;
				}
				context.report({ node, messageId: 'noTimeZone', data: { method } });
			}
		};
	}
};
