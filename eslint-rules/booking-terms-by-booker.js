/** @typedef {import('./ast.js').RuleNode} RuleNode */
/**
 * The rate, the duration floor and the booking window differ by booker: a
 * teaching booking has its own. `validateBooking` reads them through
 * `termsFor`, so a remote reading them straight off the reservation config
 * offers a teacher the member's value (#2957).
 */
const TERMS = new Set([
	'hourlyRateCents',
	'minDurationHours',
	'maxAdvanceDaysOneoff',
	'maxAdvanceDaysRecurring'
]);
const CONFIG_NAME = /config$|^cfg$/i;

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Read per-booker booking terms through termsFor.' },
		messages: {
			throughTerms:
				'{{term}} differs by booker. Read it from termsFor(bookerType, config), or ' +
				'minSlotsFor for a picker’s floor, in #lib/server/reservation/config.js.'
		}
	},
	create(context) {
		return {
			/** @param {RuleNode} node */
			MemberExpression(node) {
				if (node.computed || node.property.type !== 'Identifier') return;
				if (!TERMS.has(node.property.name)) return;
				if (node.object.type !== 'Identifier' || !CONFIG_NAME.test(node.object.name)) return;
				context.report({ node, messageId: 'throughTerms', data: { term: node.property.name } });
			}
		};
	}
};
