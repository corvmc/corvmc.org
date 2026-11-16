import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet, type Component } from 'svelte';
import * as FormExports from './index.js';
import InForm from './InForm.test.svelte';

// Class: a shared component that silently drops its children (#2804). A props
// type with `[key: string]: unknown` accepts `children`, so the compiler stays
// quiet while the component renders its own default instead. Every export is
// either rendered with children here, or refuses them at the type level.

const CHILD = 'child-content-marker';
const child = createRawSnippet(() => ({ render: () => `<span>${CHILD}</span>` }));
const option = createRawSnippet(() => ({ render: () => `<option>${CHILD}</option>` }));
const field = { as: (type: string, value?: unknown) => ({ name: 'x', type, value }) };

type Case = { props: Record<string, unknown>; inForm: boolean };
const renders: Record<string, Case[]> = {
	default: [{ props: { action: async () => {}, children: child }, inForm: false }],
	Root: [{ props: { action: async () => {}, children: child }, inForm: false }],
	Step: [{ props: { children: child }, inForm: true }],
	Field: [{ props: { name: 'x', label: 'x', children: child }, inForm: true }],
	SubmitButton: [{ props: { children: child }, inForm: true }],
	Select: [{ props: { children: option }, inForm: true }],
	CheckboxGroup: [{ props: { field, options: [], children: child }, inForm: true }],
	FileUpload: [
		{ props: { children: child }, inForm: true },
		{ props: { orientation: 'zone', children: child }, inForm: true }
	]
};
/** Inputs with no content of their own; each declares `children?: never` or has no index signature. */
const refuses: Record<string, string> = {
	MoneyField: 'MoneyField.svelte',
	SearchInput: 'SearchInput.svelte',
	DateTimeField: 'DateTimeField.svelte'
};

const sources = import.meta.glob<string>('./*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
});

describe('Form components and children', () => {
	it('classifies every export', () => {
		expect(Object.keys(FormExports).sort()).toEqual(
			[...Object.keys(renders), ...Object.keys(refuses)].sort()
		);
	});

	for (const [name, cases] of Object.entries(renders)) {
		for (const { props, inForm } of cases) {
			it(`${name} renders its children (${JSON.stringify(Object.keys(props))})`, async () => {
				const component = FormExports[name as keyof typeof FormExports] as unknown as Component<
					Record<string, unknown>
				>;
				const { container } = inForm
					? await render(InForm, { component, with: props })
					: await render(component, props);
				await expect.poll(() => container.textContent).toContain(CHILD);
			});
		}
	}

	for (const [name, file] of Object.entries(refuses)) {
		it(`${name} refuses children in its type`, () => {
			const source = sources[`./${file}`];
			const open = source.includes('[key: string]: unknown');
			expect(!open || source.includes('children?: never')).toBe(true);
		});
	}

	// The same shape outside the exports: an index signature with no `children`
	// declared lets children through to nowhere.
	it('declares children on every component with an index signature', () => {
		const silent = Object.entries(sources)
			.filter(([, s]) => s.includes('[key: string]: unknown') && !/\bchildren\??:/.test(s))
			.map(([file]) => file);
		expect(silent).toEqual([]);
	});
});
