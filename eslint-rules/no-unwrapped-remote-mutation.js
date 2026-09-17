/**
 * `src/lib/remote/_remote.ts` re-exports `form` and `command` wrapped in the
 * catch that maps a domain error to the status it declares. Importing kit's
 * originals reaches past that, so the mutation answers a business rule with a
 * 500 unless its author remembers a catch — 149 of 414 did not, which is what
 * `scripts/remote-domain-error.spec.ts` gates.
 *
 * That spec is the real check; it reads the whole server tree to know which
 * calls can throw. This is the cheap half: one file, no cross-module knowledge,
 * so it fails at the import rather than at the first call that throws.
 */

/** @import { RuleNode } from './ast.js' */

const WRAPPED = new Set(['form', 'command']);

/**
 * `imported` is an Identifier for `{ form }` and a Literal for the string form,
 * and is absent on a default or namespace specifier.
 * @param {RuleNode} spec
 * @returns {string | null}
 */
function importedName(spec) {
	if (spec.type !== 'ImportSpecifier') return null;
	return spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow importing form/command from $app/server inside src/lib/remote/, which must go through ./_remote so domain errors are mapped.'
		},
		fixable: 'code',
		messages: {
			unwrapped:
				"Import '{{names}}' from './_remote', not '$app/server'. The wrapper there maps a domain error to the status it declares; kit's original leaves it a 500."
		}
	},
	create(context) {
		return {
			ImportDeclaration(node) {
				if (node.source.value !== '$app/server') return;

				const wrapped = node.specifiers.filter((s) => WRAPPED.has(importedName(s) ?? ''));
				if (wrapped.length === 0) return;

				const names = wrapped.map((s) => importedName(s)).join(', ');
				const kept = node.specifiers.filter((s) => !wrapped.includes(s));

				context.report({
					node,
					messageId: 'unwrapped',
					data: { names },
					fix(fixer) {
						// A renamed specifier (`form as kitForm`) would need its call
						// sites rewritten too, so leave that to a human.
						const renamed = wrapped.some(
							(s) => s.type === 'ImportSpecifier' && importedName(s) !== s.local.name
						);
						if (renamed || kept.some((s) => s.type !== 'ImportSpecifier')) return null;

						const text = context.sourceCode.getText(node);
						const q = text.includes("'$app/server'") ? "'" : '"';
						const keptText = kept
							.map((s) => {
								const name = importedName(s);
								return name === s.local.name ? name : `${name} as ${s.local.name}`;
							})
							.join(', ');

						const wrapperImport = `import { ${names} } from ${q}./_remote${q};`;
						return fixer.replaceText(
							node,
							keptText
								? `import { ${keptText} } from ${q}$app/server${q};\n${wrapperImport}`
								: wrapperImport
						);
					}
				});
			}
		};
	}
};
