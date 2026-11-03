import ts from 'typescript';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';

/**
 * A call graph over `src/lib`, for the gates that ask what an exported remote
 * reaches. Syntax only, no type checker: names are resolved through imports,
 * re-exports and namespace imports, and a call it cannot resolve (a library,
 * a parameter, a method on a value) is invisible to it.
 */

/** A top-level function, remote or alias, as `file#name`. */
export type Key = `${string}#${string}`;

export type Remote = {
	key: Key;
	file: string;
	name: string;
	kind: 'query' | 'form' | 'command' | 'prerender';
	/** The handler, or the factory's handler for `export const x = makeForm(y)`. */
	handler: ts.Node;
	/** The schema argument, when the remote declares one. */
	schema?: ts.Expression;
};

type Mod = {
	file: string;
	sf: ts.SourceFile;
	/** local name → resolved module and the export it names; `*` for a namespace. */
	imports: Map<string, { file: string; name: string }>;
	/** top-level functions and remotes: name → the body to walk. */
	bodies: Map<string, ts.Node>;
	/** `const a = b` and `export { b as a }` with no `from`. */
	aliases: Map<string, string>;
	reexports: { file: string; names: Map<string, string> | null }[];
	remotes: Remote[];
	values: Set<string>;
};

const REMOTE_KINDS = new Set(['query', 'form', 'command', 'prerender']);

function resolveSpecifier(spec: string, from: string): string | null {
	let base: string;
	if (spec.startsWith('$lib/')) base = `src/lib/${spec.slice(5)}`;
	else if (spec.startsWith('.')) base = posix.join(posix.dirname(from), spec);
	else return null;
	for (const c of [base, `${base}.ts`, `${base}/index.ts`, base.replace(/\.js$/, '.ts')]) {
		if (c.endsWith('.ts') && existsSync(c) && statSync(c).isFile()) return c;
	}
	return null;
}

function isFunctionLike(n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression {
	return ts.isArrowFunction(n) || ts.isFunctionExpression(n);
}

/** `query(...)`, `form(...)`, `query.batch(...)`: the remote kind, or null. */
function remoteKind(call: ts.CallExpression): Remote['kind'] | null {
	const c = call.expression;
	if (ts.isIdentifier(c) && REMOTE_KINDS.has(c.text)) return c.text as Remote['kind'];
	if (
		ts.isPropertyAccessExpression(c) &&
		ts.isIdentifier(c.expression) &&
		c.expression.text === 'query' &&
		c.name.text === 'batch'
	)
		return 'query';
	return null;
}

function firstRemoteCall(n: ts.Node): ts.CallExpression | undefined {
	if (ts.isCallExpression(n) && remoteKind(n)) return n;
	return ts.forEachChild(n, firstRemoteCall);
}

export class CallGraph {
	private mods = new Map<string, Mod | null>();

	mod(file: string): Mod | null {
		if (this.mods.has(file)) return this.mods.get(file)!;
		this.mods.set(file, null);
		if (!existsSync(file)) return null;
		const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
		const m: Mod = {
			file,
			sf,
			imports: new Map(),
			bodies: new Map(),
			aliases: new Map(),
			reexports: [],
			remotes: [],
			values: new Set()
		};
		const factories: [string, ts.CallExpression][] = [];

		for (const st of sf.statements) {
			if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
				const target = resolveSpecifier(st.moduleSpecifier.text, file);
				const clause = st.importClause;
				if (!target || !clause || clause.isTypeOnly) continue;
				const nb = clause.namedBindings;
				if (nb && ts.isNamespaceImport(nb))
					m.imports.set(nb.name.text, { file: target, name: '*' });
				if (nb && ts.isNamedImports(nb)) {
					for (const el of nb.elements) {
						if (el.isTypeOnly) continue;
						m.imports.set(el.name.text, {
							file: target,
							name: (el.propertyName ?? el.name).text
						});
					}
				}
			} else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
				const target =
					st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
						? resolveSpecifier(st.moduleSpecifier.text, file)
						: null;
				const clause = st.exportClause;
				if (st.moduleSpecifier) {
					if (!target) continue;
					if (!clause) m.reexports.push({ file: target, names: null });
					else if (ts.isNamedExports(clause)) {
						const names = new Map(
							clause.elements.map((el) => [el.name.text, (el.propertyName ?? el.name).text])
						);
						m.reexports.push({ file: target, names });
					}
				} else if (clause && ts.isNamedExports(clause)) {
					for (const el of clause.elements) {
						if (el.propertyName) m.aliases.set(el.name.text, el.propertyName.text);
					}
				}
			} else if (ts.isFunctionDeclaration(st) && st.name && st.body) {
				m.bodies.set(st.name.text, st.body);
			} else if (ts.isVariableStatement(st)) {
				for (const d of st.declarationList.declarations) {
					if (!ts.isIdentifier(d.name) || !d.initializer) continue;
					const name = d.name.text;
					let init: ts.Expression = d.initializer;
					while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init))
						init = init.expression;
					if (isFunctionLike(init)) m.bodies.set(name, init.body);
					else if (ts.isIdentifier(init)) m.aliases.set(name, init.text);
					else if (ts.isCallExpression(init) && remoteKind(init)) this.addRemote(m, name, init);
					else if (ts.isCallExpression(init)) factories.push([name, init]);
					else m.values.add(name);
				}
			}
		}
		// `export const declineJobForm = closeJobForm(declineJob)`: the remote is
		// the one the local factory builds, so its handler is what gets walked.
		for (const [name, init] of factories) {
			const callee = init.expression;
			const body = ts.isIdentifier(callee) ? m.bodies.get(callee.text) : undefined;
			const inner = body && firstRemoteCall(body);
			if (inner) this.addRemote(m, name, inner);
			else m.values.add(name);
		}
		this.mods.set(file, m);
		return m;
	}

	private addRemote(m: Mod, name: string, call: ts.CallExpression) {
		const handler = call.arguments.at(-1);
		if (!handler) return;
		const schema = call.arguments.length > 1 ? call.arguments[0] : undefined;
		const body = isFunctionLike(handler) ? handler.body : handler;
		m.bodies.set(name, body);
		m.remotes.push({
			key: `${m.file}#${name}`,
			file: m.file,
			name,
			kind: remoteKind(call)!,
			handler: body,
			schema: schema && !ts.isStringLiteral(schema) ? schema : undefined
		});
	}

	/** Where `name`, as exported by `file`, is defined. */
	exported(file: string, name: string, seen = new Set<string>()): Key | null {
		const id = `${file}#${name}`;
		if (seen.has(id)) return null;
		seen.add(id);
		const m = this.mod(file);
		if (!m) return null;
		if (m.bodies.has(name) || m.values.has(name)) return `${file}#${name}`;
		if (m.aliases.has(name)) return this.inScope(m, m.aliases.get(name)!, seen);
		const imp = m.imports.get(name);
		if (imp && imp.name !== '*') return this.exported(imp.file, imp.name, seen);
		for (const r of m.reexports) {
			if (r.names?.has(name)) return this.exported(r.file, r.names.get(name)!, seen);
			if (!r.names) {
				const hit = this.exported(r.file, name, seen);
				if (hit) return hit;
			}
		}
		return null;
	}

	/** What an identifier written in `m` refers to. */
	inScope(m: Mod, name: string, seen = new Set<string>()): Key | null {
		const imp = m.imports.get(name);
		if (imp) return imp.name === '*' ? null : this.exported(imp.file, imp.name, seen);
		return this.exported(m.file, name, seen);
	}

	/** The function a call's callee names, if it can be resolved. */
	callee(m: Mod, expr: ts.Expression): Key | null {
		if (ts.isIdentifier(expr)) return this.inScope(m, expr.text);
		if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
			const imp = m.imports.get(expr.expression.text);
			if (imp?.name === '*') return this.exported(imp.file, expr.name.text);
		}
		return null;
	}

	body(key: Key): { mod: Mod; node: ts.Node } | null {
		const [file, name] = key.split('#');
		const m = this.mod(file);
		const node = m?.bodies.get(name);
		return m && node ? { mod: m, node } : null;
	}

	remotes(files: string[]): Remote[] {
		return files.flatMap((f) => this.mod(f)?.remotes ?? []);
	}
}

/** The key a `session` event carries: no function defines it. */
export const SESSION: Key = '(locals)#user';

/**
 * `!locals.user`, `!event.locals.user`, `!getRequestEvent().locals.user`: the
 * test `requireUser` itself makes, which several modules inline.
 */
function isSessionCheck(n: ts.Node): n is ts.PrefixUnaryExpression {
	if (!ts.isPrefixUnaryExpression(n) || n.operator !== ts.SyntaxKind.ExclamationToken) return false;
	let e: ts.Expression = n.operand;
	while (ts.isParenthesizedExpression(e)) e = e.expression;
	if (!ts.isPropertyAccessExpression(e) || e.name.text !== 'user') return false;
	const base = e.expression;
	return (
		(ts.isIdentifier(base) && base.text === 'locals') ||
		(ts.isPropertyAccessExpression(base) && base.name.text === 'locals')
	);
}

/**
 * Every call and every reference to a resolved name in `node`, in evaluation
 * order: a callee and its arguments before the call itself. `visit` returns a
 * truthy value to stop the walk.
 */
export function walkEvents<T>(
	g: CallGraph,
	mod: Mod,
	node: ts.Node,
	visit: (e: { kind: 'call' | 'ref' | 'session'; key: Key; node: ts.Node }) => T | undefined
): T | undefined {
	const go = (n: ts.Node): T | undefined => {
		if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
		if (ts.isCallExpression(n)) {
			// `getX(id).refresh()` re-runs a page query after the write: it guards
			// nothing here and reads nothing first, so it is not walked.
			const c = n.expression;
			if (ts.isPropertyAccessExpression(c) && c.name.text === 'refresh') return;
			// A bare callee is the call itself, not a reference to report twice.
			const hit =
				(ts.isIdentifier(n.expression) ? undefined : go(n.expression)) ??
				n.arguments.reduce<T | undefined>((h, a) => h ?? go(a), undefined);
			if (hit !== undefined) return hit;
			const key = g.callee(mod, n.expression);
			return key ? visit({ kind: 'call', key, node: n }) : undefined;
		}
		if (isSessionCheck(n)) {
			const hit = go(n.operand);
			return hit !== undefined ? hit : visit({ kind: 'session', key: SESSION, node: n });
		}
		if (ts.isPropertyAccessExpression(n)) return go(n.expression);
		if (ts.isIdentifier(n)) {
			if (!mod.imports.has(n.text)) return;
			const key = mod.imports.get(n.text)!.name === '*' ? null : g.inScope(mod, n.text);
			return key ? visit({ kind: 'ref', key, node: n }) : undefined;
		}
		return ts.forEachChild(n, go);
	};
	// `query(loadOnboarding)`: the handler is a named function, so it is a call.
	if (ts.isIdentifier(node)) {
		const key = g.inScope(mod, node.text);
		return key ? visit({ kind: 'call', key, node }) : undefined;
	}
	return go(node);
}
