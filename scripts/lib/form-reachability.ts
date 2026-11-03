import ts from 'typescript';

/**
 * Which optional keys a service function accepts that no `form()`/`command()`
 * ever passes it. A key like that is a capability the service spec covers and
 * no member or staffer can reach ("no form means not shipped", #2049).
 *
 * The comparison is on types, not names: the parameter type comes from the
 * resolved signature and the passed keys from the argument's own type, so
 * `svc(id, data)`, `svc({ ...data, x })` and `svc(id)` are all read correctly.
 */

export type RemoteKind = 'form' | 'command';

export interface ServiceOption {
	/** `src/lib/server/…/x-service.ts#fnName`, plus the parameter position. */
	service: string;
	param: number;
	key: string;
	/** The remotes that call this function, none of which pass `key`. */
	callers: string[];
}

export interface Report {
	unreached: ServiceOption[];
	/** `form('unchecked', …)` has no schema to compare. */
	unchecked: string[];
	/** A handler whose calls into the service layer this pass could not see. */
	noServiceCall: string[];
	remotes: number;
}

export interface AnalyseOptions {
	isService: (fileName: string) => boolean;
	/** Keys that are seams rather than options (`now` for tests), never reported. */
	ignoreKeys?: ReadonlySet<string>;
	/** Functions that are guards rather than services (`requireCapability`'s scope). */
	ignoreFunction?: (name: string) => boolean;
	/** Shorten a file name for the report. */
	label?: (fileName: string) => string;
}

const MUTATIONS = new Set<string>(['form', 'command']);

function remoteCalls(sf: ts.SourceFile): { name: string; call: ts.CallExpression }[] {
	const out: { name: string; call: ts.CallExpression }[] = [];
	for (const stmt of sf.statements) {
		if (!ts.isVariableStatement(stmt)) continue;
		if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
		for (const decl of stmt.declarationList.declarations) {
			const init = decl.initializer;
			if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) continue;
			if (!MUTATIONS.has(init.expression.text) || !ts.isIdentifier(decl.name)) continue;
			out.push({ name: decl.name.text, call: init });
		}
	}
	return out;
}

function resolve(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
	const sym = checker.getSymbolAtLocation(node);
	if (!sym) return undefined;
	return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
}

function calleeName(expr: ts.Expression): ts.Node {
	return ts.isPropertyAccessExpression(expr) ? expr.name : expr;
}

/** The object members of a type, across a union, skipping primitives and arrays. */
function objectProps(checker: ts.TypeChecker, type: ts.Type): ts.Symbol[] {
	const members = type.isUnion() ? type.types : [type];
	return members.flatMap((m) => {
		const t = checker.getApparentType(m);
		const shape = ts.TypeFlags.Object | ts.TypeFlags.Intersection;
		if (!(t.flags & shape) || checker.isArrayType(t)) return [];
		if (checker.getSignaturesOfType(t, ts.SignatureKind.Call).length) return [];
		return checker.getPropertiesOfType(t);
	});
}

function isPlainOptionsType(checker: ts.TypeChecker, type: ts.Type): boolean {
	const name = checker.typeToString(type);
	return !/^(Date|Uint8Array|ArrayBuffer|File|Blob|ReadableStream|Request|Response)\b/.test(name);
}

export function analyse(
	program: ts.Program,
	remoteFiles: readonly string[],
	opts: AnalyseOptions
): Report {
	const checker = program.getTypeChecker();
	const label = opts.label ?? ((f: string) => f);
	const ignore = opts.ignoreKeys ?? new Set<string>();
	// service#param -> { optional keys, keys passed, callers }
	const seen = new Map<
		string,
		{
			service: string;
			param: number;
			optional: Set<string>;
			passed: Set<string>;
			callers: Set<string>;
		}
	>();
	const report: Report = { unreached: [], unchecked: [], noServiceCall: [], remotes: 0 };

	for (const file of remoteFiles) {
		const sf = program.getSourceFile(file);
		if (!sf) throw new Error(`not in the program: ${file}`);
		for (const { name, call } of remoteCalls(sf)) {
			const remote = `${label(file)}#${name}`;
			report.remotes++;
			const [first] = call.arguments;
			if (first && ts.isStringLiteralLike(first) && first.text === 'unchecked') {
				report.unchecked.push(remote);
				continue;
			}
			const handler = call.arguments[call.arguments.length - 1];
			if (!handler || !(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) continue;

			let found = 0;
			const visited = new Set<ts.Node>();
			const walk = (body: ts.Node, depth: number) => {
				if (visited.has(body)) return;
				visited.add(body);
				const visit = (node: ts.Node) => {
					if (ts.isCallExpression(node)) {
						const sym = resolve(checker, calleeName(node.expression));
						const decl = sym?.declarations?.[0];
						const declFile = decl?.getSourceFile().fileName;
						if (decl && declFile && opts.isService(declFile)) {
							found++;
							if (!opts.ignoreFunction?.(sym!.name)) {
								record(node, `${label(declFile)}#${sym!.name}`, remote);
							}
						} else if (decl && declFile === sf.fileName && depth < 2) {
							// A module-local helper the handler delegates to.
							const fn = ts.isVariableDeclaration(decl) ? decl.initializer : decl;
							if (fn && ts.isFunctionLike(fn)) walk(fn, depth + 1);
						}
					}
					ts.forEachChild(node, visit);
				};
				ts.forEachChild(body, visit);
			};
			walk(handler, 0);
			if (!found) report.noServiceCall.push(remote);
		}
	}

	function record(call: ts.CallExpression, service: string, remote: string) {
		const sig = checker.getResolvedSignature(call);
		if (!sig) return;
		sig.parameters.forEach((param, i) => {
			const pdecl = param.valueDeclaration;
			if (pdecl && ts.isParameter(pdecl) && pdecl.dotDotDotToken) return;
			const ptype = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(param, call));
			if (!isPlainOptionsType(checker, ptype)) return;
			const optional = objectProps(checker, ptype)
				.filter((p) => p.flags & ts.SymbolFlags.Optional)
				.map((p) => p.name)
				.filter((k) => !ignore.has(k));
			if (!optional.length) return;

			const key = `${service}#${i}`;
			const entry = seen.get(key) ?? {
				service,
				param: i,
				optional: new Set<string>(),
				passed: new Set<string>(),
				callers: new Set<string>()
			};
			seen.set(key, entry);
			optional.forEach((k) => entry.optional.add(k));
			entry.callers.add(remote);

			const arg = call.arguments[i];
			if (!arg) return;
			const atype = checker.getTypeAtLocation(arg);
			if (atype.flags & ts.TypeFlags.Any) optional.forEach((k) => entry.passed.add(k));
			else objectProps(checker, atype).forEach((p) => entry.passed.add(p.name));
		});
	}

	for (const e of seen.values()) {
		for (const key of [...e.optional].sort()) {
			if (e.passed.has(key)) continue;
			report.unreached.push({
				service: e.service,
				param: e.param,
				key,
				callers: [...e.callers].sort()
			});
		}
	}
	report.unreached.sort((a, b) =>
		a.service === b.service
			? a.param - b.param || a.key.localeCompare(b.key)
			: a.service.localeCompare(b.service)
	);
	report.unchecked.sort();
	report.noServiceCall.sort();
	return report;
}
