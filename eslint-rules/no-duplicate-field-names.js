/**
 * Resolve the submitted property name from an element's attributes, or null when it
 * can't be determined statically.
 *
 * Two static-analyzable forms (see src/lib/components/ui/Form/FormField.svelte):
 *   name="bio"          -> "bio"
 *   field={fields.bio}  -> "bio"  (FormField derives its name from the field)
 *
 * @param {any} node a SvelteElement
 * @returns {{ name: string, attr: any } | null}
 */
function resolveFieldName(node) {
	const attributes = node.startTag?.attributes ?? [];

	for (const attr of attributes) {
		if (attr.type !== 'SvelteAttribute') continue;

		// name="bio" — single literal value.
		if (attr.key?.name === 'name') {
			if (
				attr.value?.length === 1 &&
				attr.value[0].type === 'SvelteLiteral' &&
				typeof attr.value[0].value === 'string'
			) {
				return { name: attr.value[0].value, attr };
			}
			// Dynamic name={expr} — not statically resolvable.
			return null;
		}

		// field={fields.bio} or field={fields['bio']} — derive the property name.
		if (attr.key?.name === 'field') {
			if (attr.value?.length === 1 && attr.value[0].type === 'SvelteMustacheTag') {
				const expr = attr.value[0].expression;
				if (expr?.type === 'MemberExpression') {
					if (!expr.computed && expr.property?.type === 'Identifier') {
						return { name: expr.property.name, attr };
					}
					if (
						expr.computed &&
						expr.property?.type === 'Literal' &&
						typeof expr.property.value === 'string'
					) {
						return { name: expr.property.value, attr };
					}
				}
			}
			return null;
		}
	}

	return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow two form fields submitting the same property name within one form.'
		},
		messages: {
			duplicateName:
				'Duplicate form field name "{{name}}" in this <Form>. Each field must submit a unique property name.'
		}
	},
	create(context) {
		/** @type {Array<{ names: Map<string, any> }>} */
		const formStack = [];

		function isFormTag(node) {
			const tag = node.name?.name;
			return tag === 'Form' || tag === 'form';
		}

		return {
			SvelteElement(node) {
				if (isFormTag(node)) {
					formStack.push({ names: new Map() });
					return;
				}

				const scope = formStack[formStack.length - 1];
				if (!scope) return;

				// Only consider field *components* (FormField, Field, FileUpload, …). Raw HTML
				// elements legitimately share a `name`: radio groups, native checkbox groups, and
				// `<input type="hidden">` mirrors. The codebase routes submissions through field
				// components anyway, so this targets the real duplicate-field bug without flagging
				// those patterns.
				const tag = node.name?.name;
				const isComponent =
					node.kind === 'component' || (typeof tag === 'string' && /^[A-Z]/.test(tag));
				if (!isComponent) return;

				// `<Select>` is a markup wrapper around a bare `<select>`, not a field component —
				// it carries no label or issue handling of its own. It is routinely nested inside a
				// `<Field name="…">` that renders only its children, so the pair submits one value,
				// not two. Treat it like the raw `<select>` it replaced.
				if (tag === 'Select') return;

				const resolved = resolveFieldName(node);
				if (!resolved) return;

				if (scope.names.has(resolved.name)) {
					context.report({
						node: resolved.attr,
						messageId: 'duplicateName',
						data: { name: resolved.name }
					});
				} else {
					scope.names.set(resolved.name, resolved.attr);
				}
			},
			'SvelteElement:exit'(node) {
				if (isFormTag(node)) formStack.pop();
			}
		};
	}
};
