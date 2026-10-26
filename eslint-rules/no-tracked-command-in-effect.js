/**
 * A remote `command()` called inside an `$effect` must be called through `untrack`.
 *
 * Kit's client command does `pending_count++` on a `$state` synchronously on every
 * call. `++` reads before it writes, so the effect subscribes to the counter, the
 * write re-runs the effect, and the effect calls the command again — until Svelte
 * stops at depth 1000 with `effect_update_depth_exceeded` (#1956). A guard that
 * returns early survives by luck: it re-runs once, then reads nothing.
 */

/** @typedef {import('./ast.js').RuleNode} RuleNode */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const EFFECTS = new Set(['$effect', '$effect.pre']);

/**
 * Which names a remote module exports as commands. A query called from an effect is
 * fine — and `untrack` around it would drop the dependency on its argument — so the
 * rule needs to know which is which, and only the module knows.
 * @type {Map<string, Set<string>>}
 */
const commandsByModule = new Map();

/** @param {string} file */
function commandsIn(file) {
	let names = commandsByModule.get(file);
	if (names) return names;
	names = new Set();
	if (existsSync(file)) {
		for (const m of readFileSync(file, 'utf8').matchAll(/export const (\w+) = command\(/g))
			names.add(m[1]);
	}
	commandsByModule.set(file, names);
	return names;
}

/**
 * @param {string} source
 * @param {string} importer
 * @param {string} cwd
 */
function resolveRemote(source, importer, cwd) {
	const base = source.startsWith('$lib/')
		? join(cwd, 'src/lib', source.slice('$lib/'.length))
		: source.startsWith('.')
			? resolve(dirname(importer), source)
			: null;
	return base && `${base}.ts`;
}

/** @param {RuleNode} callee */
function calleeName(callee) {
	if (callee.type === 'Identifier') return callee.name;
	if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier')
		return `${callee.object.name}.${callee.property.name}`;
	return null;
}

/** @param {RuleNode} n */
const isFunction = (n) =>
	n.type === 'ArrowFunctionExpression' ||
	n.type === 'FunctionExpression' ||
	n.type === 'FunctionDeclaration';

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require remote commands called inside $effect to go through untrack, since a command call reads and writes a $state of its own.'
		},
		messages: {
			tracked:
				"'{{name}}' is a remote command called inside an effect. Wrap the call in `untrack(() => …)`: a command reads and writes kit's own pending count on every call, which re-runs this effect and calls it again (effect_update_depth_exceeded, #1956)."
		}
	},
	create(context) {
		/** @type {Set<string>} */
		const commands = new Set();

		/** @param {RuleNode} node */
		const children = (node) => {
			/** @type {RuleNode[]} */
			const out = [];
			for (const key of Object.keys(node)) {
				if (key === 'parent') continue;
				const child = node[key];
				if (Array.isArray(child)) out.push(...child.filter((c) => c && typeof c.type === 'string'));
				else if (child && typeof child.type === 'string') out.push(child);
			}
			return out;
		};

		/** Calls the effect makes while it runs — not in a nested function, not in untrack. */
		/** @param {RuleNode} node */
		const visit = (node) => {
			if (isFunction(node)) return;
			if (node.type === 'CallExpression') {
				const name = calleeName(node.callee);
				if (name === 'untrack') return;
				if (name && commands.has(name))
					context.report({ node, messageId: 'tracked', data: { name } });
			}
			children(node).forEach(visit);
		};

		return {
			ImportDeclaration(node) {
				const source = String(node.source.value ?? '');
				if (!/\.remote$/.test(source)) return;
				const file = resolveRemote(source, context.filename, context.cwd);
				if (!file) return;
				const exported = commandsIn(file);
				for (const spec of node.specifiers) {
					if (spec.type !== 'ImportSpecifier') continue;
					const imported =
						spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value);
					if (exported.has(imported)) commands.add(spec.local.name);
				}
			},
			CallExpression(node) {
				if (commands.size === 0 || !EFFECTS.has(calleeName(node.callee) ?? '')) return;
				const fn = node.arguments[0];
				if (fn && isFunction(fn)) visit(fn.body);
				else if (fn) visit(fn);
			}
		};
	}
};
