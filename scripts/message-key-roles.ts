/**
 * Renames every message key to end with the role its string plays (#2513).
 *
 * `pnpm messages:roles` reads each `m.<key>` under `src/`, works out its role
 * (see `roleOf`), then renames the key, gives a key used in two roles one key
 * per role with the same text, and deletes a key nothing reads. It is
 * idempotent: re-run it after a rebase rather than resolving a conflict by hand.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as tsParser from '@typescript-eslint/parser';
import { parseForESLint as parseSvelte } from 'svelte-eslint-parser';
import {
	ROLES,
	attributeRole,
	climb,
	propContextRole,
	propRole
} from '../eslint-rules/message-key-role.js';

export type Role = (typeof ROLES)[number];
type Node = any;

const ROOT = join(import.meta.dirname, '..');
const PRIORITY: Role[] = [
	'title',
	'label',
	'checkbox',
	'placeholder',
	'toast',
	'error',
	'body',
	'text'
];
const TITLE_ELEMENTS = new Set([
	'h1',
	'h2',
	'h3',
	'h4',
	'legend',
	'title',
	'CardTitle',
	'SectionHeading'
]);
const LABEL_ELEMENTS = new Set([
	'th',
	'button',
	'Button',
	'SubmitButton',
	'option',
	'label',
	'dt',
	'Badge',
	'summary'
]);
const BODY_ELEMENTS = new Set(['Alert']);
const INLINE_ELEMENTS = new Set(['span', 'strong', 'em', 'b', 'i', 'small', 'abbr']);
const BLOCKS = /^Svelte(If|Else|Each|Await\w*|Key)Block$/;
const ERROR_CALLS = new Set(['error', 'fail', 'invalid', 'Error']);

/** Name a variable or function was given, read as a prop name: `errorText` is an error. */
function nameRole(name: string): Role | null {
	if (/error/i.test(name)) return 'error';
	return propRole(name) ?? propRole(`x${name.charAt(0).toUpperCase()}${name.slice(1)}`);
}

/** The element a text node sits in, through inline wrappers, blocks and `children`. */
function elementRole(start: Node): Role[] {
	for (let n = start; n; n = n.parent) {
		if (BLOCKS.test(n.type)) continue;
		if (n.type === 'SvelteSnippetBlock') {
			const role = propRole(n.id?.name ?? '');
			if (role) return [role];
			if (n.id?.name === 'children') continue;
			return ['text'];
		}
		if (n.type !== 'SvelteElement') return ['text'];
		const name = n.name?.name ?? n.name?.property?.name;
		if (TITLE_ELEMENTS.has(name)) return ['title'];
		if (LABEL_ELEMENTS.has(name)) return ['label'];
		if (BODY_ELEMENTS.has(name)) return ['body'];
		if (!INLINE_ELEMENTS.has(name)) return ['text'];
	}
	return ['text'];
}

class FileRoles {
	constructor(
		private readonly scopeManager: Node,
		private readonly messageIds: Set<Node>
	) {}

	isMessage = (node: Node) =>
		node?.type === 'MemberExpression' && !node.computed && this.messageIds.has(node.object);

	/** Every role the value at `start` reaches, following variables and functions. */
	roleOf(start: Node, depth = 0): Role[] {
		if (depth > 8) return [];
		const { value, parent } = climb(start);
		if (!parent) return [];
		const direct = propContextRole(value, parent, this.isMessage) as Role | null;
		if (direct) return [direct];
		const up = (n: Node) => this.roleOf(n, depth + 1);
		switch (parent.type) {
			case 'SvelteMustacheTag': {
				const attribute = parent.parent;
				if (attribute?.type !== 'SvelteAttribute') return elementRole(attribute);
				const element = attribute.parent?.parent;
				return element?.name?.name === 'ParaglideMessage' ? elementRole(element.parent) : [];
			}
			case 'SvelteShorthandAttribute': {
				const role = attributeRole(parent.key?.name ?? '', parent.parent?.parent);
				return role ? [role as Role] : [];
			}
			case 'Property':
				return parent.value === value ? up(parent.parent) : [];
			case 'ArrayExpression':
			case 'SpreadElement':
				return up(parent);
			case 'MemberExpression':
				return parent.object === value ? up(parent) : [];
			case 'CallExpression':
			case 'NewExpression': {
				const callee = parent.callee;
				const name = callee?.name ?? callee?.object?.name;
				if (/^\$(derived|state)$/.test(name ?? '')) return up(parent);
				if (ERROR_CALLS.has(callee?.name ?? '')) return ['error'];
				return [];
			}
			case 'ThrowStatement':
				return ['error'];
			case 'VariableDeclarator':
				return parent.init === value ? this.variable(parent, parent.id?.name, depth) : [];
			case 'AssignmentExpression': {
				if (parent.right !== value) return [];
				const left = parent.left;
				if (left.type === 'MemberExpression') {
					const role = propRole(left.property?.name ?? '');
					return role ? [role as Role] : [];
				}
				const variable = this.resolve(left);
				return variable ? this.reads(variable, left.name, depth) : [];
			}
			case 'ReturnStatement':
				return this.fn(enclosingFunction(parent), depth);
			case 'ArrowFunctionExpression':
				return parent.body === value ? this.fn(parent, depth) : [];
			default:
				return [];
		}
	}

	private resolve(identifier: Node): Node {
		for (const scope of this.scopeManager.scopes)
			for (const ref of scope.references) if (ref.identifier === identifier) return ref.resolved;
		return null;
	}

	private variable(declarator: Node, name: string | undefined, depth: number): Role[] {
		const [variable] = this.scopeManager.getDeclaredVariables(declarator);
		if (!variable) return [];
		return this.reads(variable, name ?? '', depth);
	}

	private reads(variable: Node, name: string, depth: number): Role[] {
		const roles = variable.references
			.filter((ref: Node) => ref.isRead())
			.flatMap((ref: Node) => {
				const id = ref.identifier;
				const call = id.parent?.type === 'CallExpression' && id.parent.callee === id;
				return this.roleOf(call ? id.parent : id, depth + 1);
			});
		const known = roles.filter((r: Role) => r !== 'text');
		const named = nameRole(name);
		if (known.length) return roles;
		return named ? [named] : roles;
	}

	private fn(fn: Node, depth: number): Role[] {
		if (!fn) return [];
		const parent = fn.parent;
		if (fn.type === 'FunctionDeclaration') return this.variable(fn, fn.id?.name, depth);
		if (parent?.type === 'VariableDeclarator') return this.variable(parent, parent.id?.name, depth);
		if (parent?.type === 'Property') {
			const role = propRole(parent.key?.name ?? '');
			return role ? [role as Role] : [];
		}
		if (parent?.type === 'CallExpression') return this.roleOf(parent, depth + 1);
		return [];
	}
}

function enclosingFunction(node: Node): Node {
	for (let n = node.parent; n; n = n.parent) if (/Function/.test(n.type)) return n;
	return null;
}

/** Sets `parent` on every node, which neither parser does for script ESTree. */
function linkParents(node: Node, visitorKeys: Record<string, string[]>, parent: Node = null) {
	node.parent = parent;
	for (const key of visitorKeys[node.type] ?? []) {
		const child = node[key];
		for (const c of Array.isArray(child) ? child : [child])
			if (c && typeof c.type === 'string') linkParents(c, visitorKeys, node);
	}
}

export interface Reference {
	file: string;
	key: string;
	start: number;
	end: number;
	role: Role;
	/** Roles the reference reached by following a variable, when more than one. */
	ambiguous?: Role[];
}

export function pick(roles: Role[]): Role {
	return PRIORITY.find((r) => roles.includes(r)) ?? 'text';
}

/** Every catalog reference in one source file, with the role it plays there. */
export function referencesIn(file: string, code: string): Reference[] {
	const parsed: Node = file.endsWith('.svelte')
		? parseSvelte(code, {
				parser: tsParser,
				filePath: file,
				sourceType: 'module',
				ecmaVersion: 2022
			})
		: tsParser.parseForESLint(code, {
				filePath: file,
				sourceType: 'module',
				range: true,
				loc: true
			});
	linkParents(parsed.ast, parsed.visitorKeys);
	const imports = parsed.scopeManager.scopes
		.flatMap((s: Node) => s.variables)
		.filter((v: Node) =>
			v.defs.some(
				(d: Node) =>
					d.type === 'ImportBinding' &&
					d.node.imported?.name === 'm' &&
					/paraglide\/messages(\.js)?$/.test(d.parent?.source?.value ?? '')
			)
		);
	const ids = new Set<Node>(
		imports.flatMap((v: Node) => v.references.map((r: Node) => r.identifier))
	);
	const roles = new FileRoles(parsed.scopeManager, ids);
	const out: Reference[] = [];
	for (const id of ids) {
		const member = id.parent;
		if (member?.type !== 'MemberExpression' || member.object !== id || member.computed) continue;
		const key = member.property.name;
		if (key.startsWith('term_')) continue;
		const called = member.parent?.type === 'CallExpression' && member.parent.callee === member;
		const reached = [...new Set(roles.roleOf(called ? member.parent : member))];
		const ref: Reference = {
			file,
			key,
			start: member.property.range[0],
			end: member.property.range[1],
			role: pick(reached)
		};
		if (reached.filter((r) => r !== 'text').length > 1) ref.ambiguous = reached;
		out.push(ref);
	}
	return out;
}

/**
 * The new name for `key` in each role it plays. A trailing role word the key
 * already carries is dropped first, so `x_title` used as a title stays `x_title`
 * and a key split into title and label becomes `x_title` and `x_label`.
 */
export function namesFor(key: string, roles: Role[]): Map<Role, string> {
	const last = key.match(/_([a-z]+)$/)?.[1] as Role | undefined;
	const base = last && roles.includes(last) ? key.slice(0, -(last.length + 1)) : key;
	return new Map(roles.map((role) => [role, `${base}_${role}`]));
}

export interface Plan {
	/** old key → role → new key */
	renames: Map<string, Map<Role, string>>;
	deleted: string[];
}

/** Assigns every catalog key its new names, keeping names that are already right. */
export function plan(catalogKeys: string[], usage: Map<string, Set<Role>>): Plan {
	const renames = new Map<string, Map<Role, string>>();
	const deleted: string[] = [];
	const taken = new Set<string>();
	const wanted = [...new Set(catalogKeys)]
		.filter((key) => !key.startsWith('term_') && key !== '$schema')
		.map((key) => ({ key, names: namesFor(key, [...(usage.get(key) ?? [])].sort()) }));
	for (const { key, names } of wanted) if (names.size === 0) deleted.push(key);
	const stable = ({ key, names }: { key: string; names: Map<Role, string> }) =>
		names.size === 1 && [...names.values()][0] === key;
	for (const entry of [...wanted.filter(stable), ...wanted.filter((e) => !stable(e))]) {
		if (entry.names.size === 0) continue;
		const assigned = new Map<Role, string>();
		for (const [role, name] of entry.names) {
			let free = name;
			for (let n = 2; taken.has(free); n++)
				free = name.replace(new RegExp(`_${role}$`), `_${n}_${role}`);
			taken.add(free);
			assigned.set(role, free);
		}
		renames.set(entry.key, assigned);
	}
	return { renames, deleted };
}

function catalogFiles(): string[] {
	const settings = JSON.parse(readFileSync(join(ROOT, 'project.inlang/settings.json'), 'utf8'));
	return settings['plugin.inlang.messageFormat'].pathPattern.map((p: string) =>
		join(ROOT, p.replace('{locale}', 'en'))
	);
}

function main() {
	const sources = execFileSync('git', ['grep', '-lE', 'paraglide/messages', '--', 'src'], {
		cwd: ROOT,
		encoding: 'utf8'
	})
		.trim()
		.split('\n')
		.filter((f) => !f.startsWith('src/lib/paraglide/'));
	const refs = sources.flatMap((f) => referencesIn(f, readFileSync(join(ROOT, f), 'utf8')));
	const usage = new Map<string, Set<Role>>();
	for (const r of refs) usage.set(r.key, (usage.get(r.key) ?? new Set()).add(r.role));

	const catalogs = catalogFiles().map((path) => ({
		path,
		json: JSON.parse(readFileSync(path, 'utf8'))
	}));
	const { renames, deleted } = plan(
		catalogs.flatMap((c) => Object.keys(c.json)),
		usage
	);

	const dry = process.argv.includes('--dry');
	const owner = new Map<string, string>();
	for (const { path, json } of catalogs)
		for (const key of Object.keys(json)) {
			const area = key.split('_')[0];
			if (!owner.has(key) || path.endsWith(`/${area}.json`)) owner.set(key, path);
		}
	for (const { path, json } of catalogs) {
		const entries: [string, unknown][] = [];
		for (const [key, value] of Object.entries(json)) {
			if (key === '$schema' || key.startsWith('term_')) entries.push([key, value]);
			else if (owner.get(key) === path)
				for (const name of renames.get(key)?.values() ?? []) entries.push([name, value]);
		}
		const next = JSON.stringify(Object.fromEntries(entries));
		if (!dry && next !== JSON.stringify(json))
			writeFileSync(path, `${JSON.stringify(JSON.parse(next), null, '\t')}\n`);
	}

	const byFile = new Map<string, Reference[]>();
	for (const r of refs) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
	for (const [file, list] of byFile) {
		let code = readFileSync(join(ROOT, file), 'utf8');
		for (const r of list.sort((a, b) => b.start - a.start)) {
			const name = renames.get(r.key)?.get(r.role);
			if (name && name !== r.key) code = code.slice(0, r.start) + name + code.slice(r.end);
		}
		if (!dry) writeFileSync(join(ROOT, file), code);
	}

	const renamed = [...renames].filter(([key, names]) => names.size > 1 || !hasName(names, key));
	const split = [...renames].filter(([, names]) => names.size > 1);
	console.log(
		`${renames.size} keys: ${renamed.length} renamed, of which ${split.length} split; ${deleted.length} unused deleted`
	);
	const missing = [...usage.keys()].filter((k) => !renames.has(k));
	if (missing.length) console.log(`referenced but not in the catalog: ${missing.join(', ')}`);
	if (process.argv.includes('--verbose')) {
		for (const r of refs.filter((r) => r.ambiguous))
			console.log(`ambiguous ${r.file} ${r.key}: ${r.ambiguous?.join('/')} -> ${r.role}`);
		for (const [key, names] of split) console.log(`split ${key}: ${[...names.values()].join(' ')}`);
		for (const [key, names] of renamed)
			console.log(`rename ${key}: ${[...names.values()].join(' ')}`);
		console.log(`deleted: ${deleted.join(' ')}`);
	}
}

const hasName = (names: Map<Role, string>, key: string) => [...names.values()].includes(key);

if (process.argv[1] === import.meta.filename) main();
