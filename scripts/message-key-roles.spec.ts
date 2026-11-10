import { describe, expect, it } from 'vitest';
import { namesFor, plan, referencesIn, type Role } from './message-key-roles.js';

const head = '<script lang="ts">import { m } from \'$lib/paraglide/messages.js\';';
const roles = (code: string, file = 'a.svelte') =>
	Object.fromEntries(referencesIn(file, code).map((r) => [r.key, r.role]));

describe('referencesIn', () => {
	it('reads the role from the prop a key is passed to', () => {
		const code = `${head}</script><Action label={m.a()} modalTitle={m.b()} successToast={m.c()} checkboxLabel={m.d()} emptyLabel={m.e()} />`;
		expect(roles(code)).toEqual({ a: 'label', b: 'title', c: 'toast', d: 'checkbox', e: 'title' });
	});

	it('reads text from the element it sits in', () => {
		const code = `${head}</script><h2>{m.a()}</h2><th>{m.b()}</th><p>{m.c()}</p><Button><span>{m.d()}</span></Button>`;
		expect(roles(code)).toEqual({ a: 'title', b: 'label', c: 'text', d: 'label' });
	});

	it('follows a variable and a function to where they are rendered', () => {
		const code = `${head}
			const heading = $derived(open ? m.a() : m.b());
			function status(s: string) { return s === 'x' ? m.c() : m.d(); }
		</script><h1>{heading}</h1><Badge label={status(x)} />`;
		expect(roles(code)).toEqual({ a: 'title', b: 'title', c: 'label', d: 'label' });
	});

	it('treats a message input as text and ignores a shadowing `m`', () => {
		const code = `${head}</script><p title={m.a({ title: m.b() })}></p>{#each xs as m}{m.c}{/each}`;
		expect(roles(code)).toEqual({ a: 'label', b: 'text' });
	});

	it('reads properties and toasts in a module', () => {
		const code = `import { m as msg } from '$lib/paraglide/messages.js';
			export const nav = [{ label: msg.a(), description: msg.b() }]; toast.error(msg.c());`;
		expect(roles(code, 'a.ts')).toEqual({ a: 'label', b: 'body', c: 'toast' });
	});
});

describe('namesFor', () => {
	it('appends the role, dropping a matching role word already there', () => {
		expect(namesFor('x_delete', ['label'])).toEqual(new Map([['label', 'x_delete_label']]));
		expect(namesFor('x_modal_title', ['title'])).toEqual(new Map([['title', 'x_modal_title']]));
		expect([...namesFor('x_title', ['label', 'title']).values()]).toEqual(['x_label', 'x_title']);
	});
});

describe('plan', () => {
	const usage = (entries: [string, Role[]][]) => new Map(entries.map(([k, r]) => [k, new Set(r)]));

	it('splits a dual-role key, deletes an unused one, and leaves terms alone', () => {
		const { renames, deleted } = plan(['term_band', 'a', 'b'], usage([['a', ['label', 'title']]]));
		expect([...renames.get('a')!.values()]).toEqual(['a_label', 'a_title']);
		expect(deleted).toEqual(['b']);
		expect(renames.has('term_band')).toBe(false);
	});

	it('keeps a name that is already right and numbers the one that would collide', () => {
		const { renames } = plan(
			['a', 'a_label'],
			usage([
				['a', ['label']],
				['a_label', ['label']]
			])
		);
		expect(renames.get('a_label')!.get('label')).toBe('a_label');
		expect(renames.get('a')!.get('label')).toBe('a_2_label');
	});

	it('is a fixed point once every key is named for its role', () => {
		const { renames } = plan(
			['a_label', 'a_title'],
			usage([
				['a_label', ['label']],
				['a_title', ['title']]
			])
		);
		expect([...renames].every(([key, names]) => [...names.values()].includes(key))).toBe(true);
	});
});
