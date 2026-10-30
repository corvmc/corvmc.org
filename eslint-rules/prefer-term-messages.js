import { readFileSync } from 'node:fs';

/** @typedef {import('./ast.js').RuleNode} RuleNode */

/**
 * A catalogued term typed out as a whole label reads the catalog instead
 * (#2098), so a relabel such as #2097 is one edit to `messages/en.json`.
 *
 * Flags a template text node, a user-facing attribute, or a `label`/`title`
 * property whose entire string is one form of a `term_*` message. Prose that
 * merely contains the word is not seen: that is the full catalog's job (#2099).
 */

const ATTRIBUTES = new Set([
	'label',
	'title',
	'heading',
	'placeholder',
	'aria-label',
	'alt',
	'modalTitle',
	'submitLabel',
	'description',
	'emptyLabel'
]);
const PROPERTIES = new Set(['label', 'title', 'heading']);

/**
 * Every form of every `term_*` message, lower-cased, to the message key.
 * @param {Record<string, unknown>} catalog
 * @param {string[] | undefined} only
 */
export function termForms(catalog, only) {
	/** @type {Map<string, string>} */
	const forms = new Map();
	for (const [key, value] of Object.entries(catalog)) {
		if (!key.startsWith('term_') || (only && !only.includes(key))) continue;
		const variants = Array.isArray(value) ? value : [value];
		for (const variant of variants) {
			const texts = typeof variant === 'string' ? [variant] : Object.values(variant?.match ?? {});
			for (const text of texts) forms.set(String(text).toLowerCase(), key);
		}
	}
	return forms;
}

const catalogUrl = new URL('../messages/en.json', import.meta.url);

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'suggestion',
		docs: { description: 'Read a catalogued term from $lib/terms rather than typing it.' },
		schema: [
			{
				type: 'object',
				properties: {
					catalog: { type: 'object' },
					terms: { type: 'array', items: { type: 'string' } }
				},
				additionalProperties: false
			}
		],
		messages: {
			term: '"{{text}}" is the {{key}} message. Use one(m.{{key}}) / many(m.{{key}}) from $lib/terms, or entityLabels, so a relabel is one catalog edit.'
		}
	},
	create(context) {
		const options = context.options[0] ?? {};
		const catalog = options.catalog ?? JSON.parse(readFileSync(catalogUrl, 'utf8'));
		const forms = termForms(catalog, options.terms);

		/** @param {RuleNode} node @param {unknown} value */
		function check(node, value) {
			if (typeof value !== 'string') return;
			const text = value.trim();
			const key = forms.get(text.toLowerCase());
			if (key) context.report({ node, messageId: 'term', data: { text, key } });
		}

		return {
			/** @param {RuleNode} node */
			SvelteText(node) {
				check(node, node.value);
			},
			/** @param {RuleNode} node */
			SvelteAttribute(node) {
				if (!ATTRIBUTES.has(node.key?.name)) return;
				const parts = node.value ?? [];
				if (parts.length === 1 && parts[0].type === 'SvelteLiteral')
					check(parts[0], parts[0].value);
			},
			/** @param {RuleNode} node */
			Property(node) {
				const name = node.key?.name ?? node.key?.value;
				if (PROPERTIES.has(name) && node.value?.type === 'Literal')
					check(node.value, node.value.value);
			}
		};
	}
};
