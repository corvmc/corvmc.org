import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { analyse } from './form-reachability';

const ROOT = '/virtual/src/lib';

const FILES: Record<string, string> = {
	[`${ROOT}/server/svc.ts`]: `
		export function update(id: string, input: { title?: string; notes?: string; now?: Date }) {}
		export function create(input: { a: string; b?: number }) {}
		export function patch(input: { x?: string; y?: string }) {}
		export function requireThing(scope?: { groupId?: string }) {}
	`,
	[`${ROOT}/remote/things.remote.ts`]: `
		import { update, create, patch, requireThing } from '../server/svc';
		declare function form<T>(schema: { out: T }, fn: (data: T) => unknown): unknown;
		declare function form(schema: 'unchecked', fn: () => unknown): unknown;
		declare function command<T>(schema: { out: T }, fn: (data: T) => unknown): unknown;
		declare function s<T>(t: T): { out: T };

		export const editTitle = form(s({ id: '', title: '' as string | undefined }), async (data) => {
			requireThing();
			update(data.id, { title: data.title });
		});
		export const viaHelper = command(s({ id: '' }), async (data) => go(data.id));
		function go(id: string) {
			create({ a: id });
		}
		export const intersected = form(s({}), async () => {
			patch({ x: '1' } as { x?: string } & { y?: string });
		});
		export const raw = form('unchecked', async () => {});
		export const noService = form(s({}), async () => 1);
	`
};

function program(): ts.Program {
	const options: ts.CompilerOptions = {
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true
	};
	const host = ts.createCompilerHost(options);
	const real = { getSourceFile: host.getSourceFile, fileExists: host.fileExists };
	host.fileExists = (f) => f in FILES || real.fileExists(f);
	host.directoryExists = (d) => d.startsWith('/virtual') || ts.sys.directoryExists(d);
	host.readFile = (f) => FILES[f] ?? ts.sys.readFile(f);
	host.getSourceFile = (f, lang, ...rest) =>
		f in FILES ? ts.createSourceFile(f, FILES[f], lang) : real.getSourceFile(f, lang, ...rest);
	return ts.createProgram({ rootNames: Object.keys(FILES), options, host });
}

describe('form reachability', () => {
	const report = analyse(program(), [`${ROOT}/remote/things.remote.ts`], {
		isService: (f) => f.startsWith(`${ROOT}/server/`),
		ignoreKeys: new Set(['now']),
		ignoreFunction: (name) => /^require[A-Z]/.test(name),
		label: (f) => f.slice(ROOT.length + 1)
	});

	it('reports an optional key no remote passes, and only that key', () => {
		expect(report.unreached).toEqual([
			{
				service: 'server/svc.ts#create',
				param: 0,
				key: 'b',
				callers: ['remote/things.remote.ts#viaHelper']
			},
			{
				service: 'server/svc.ts#update',
				param: 1,
				key: 'notes',
				callers: ['remote/things.remote.ts#editTitle']
			}
		]);
	});

	it('lists what it cannot compare instead of passing over it', () => {
		expect(report.unchecked).toEqual(['remote/things.remote.ts#raw']);
		expect(report.noServiceCall).toEqual(['remote/things.remote.ts#noService']);
		expect(report.remotes).toBe(5);
	});
});
