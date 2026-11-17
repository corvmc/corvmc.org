import { afterEach, describe, expect, it } from 'vitest';
import { holdEarlySubmits } from './hold-early-submit.js';

// The shape kit's `form.enhance()` returns: plain attributes plus a symbol-keyed
// attachment that adds the submit listener, and refuses a second live form.
function fakeEnhance() {
	const seen: (Element | null)[] = [];
	let element: HTMLFormElement | null = null;
	const onsubmit = (e: SubmitEvent) => {
		e.preventDefault();
		seen.push(e.submitter);
	};
	const key = Symbol('@attach');
	const attrs = {
		method: 'POST',
		action: '?/remote=x',
		[key]: (form: HTMLFormElement) => {
			if (element) throw new Error('remote_form_multiple_elements');
			element = form;
			form.addEventListener('submit', onsubmit);
			return () => {
				form.removeEventListener('submit', onsubmit);
				element = null;
			};
		}
	};
	return { attrs, key, seen };
}

let nativeSubmits = 0;
// On the document, so it runs after every listener on the form itself.
const countNative = (e: Event) => {
	if (!e.defaultPrevented) nativeSubmits++;
	e.preventDefault();
};
document.addEventListener('submit', countNative);
afterEach(() => {
	nativeSubmits = 0;
	document.body.replaceChildren();
});

function mountForm(gated: ReturnType<typeof holdEarlySubmits>) {
	const form = document.createElement('form');
	const button = document.createElement('button');
	button.type = 'submit';
	form.append(button);
	document.body.append(form);
	// Stands in for Form.svelte's `onsubmitcapture`.
	form.addEventListener('submit', (e) => void gated.hold(e), { capture: true });
	return { form, button };
}

const flush = () => new Promise((r) => setTimeout(r));

describe('holdEarlySubmits', () => {
	it('sends a submit made before the attachment runs through kit', async () => {
		const { attrs, seen } = fakeEnhance();
		const gated = holdEarlySubmits(attrs);
		const { button } = mountForm(gated);

		button.click();
		await flush();

		expect(seen).toEqual([button]);
		expect(nativeSubmits).toBe(0);
	});

	it('does not attach twice when the late effect runs on the same form', async () => {
		const { attrs, key, seen } = fakeEnhance();
		const gated = holdEarlySubmits(attrs);
		const { form, button } = mountForm(gated);

		button.click();
		await flush();
		const teardown = gated.attrs[key](form);
		button.click();
		await flush();

		expect(seen).toEqual([button, button]);
		expect(nativeSubmits).toBe(0);
		teardown?.();
	});

	it('frees the instance for the next form when the early form is gone', async () => {
		const { attrs, key, seen } = fakeEnhance();
		const first = holdEarlySubmits(attrs);
		const a = mountForm(first);
		a.button.click();
		await flush();
		a.form.remove();

		const second = holdEarlySubmits(attrs);
		const b = mountForm(second);
		expect(() => second.attrs[key](b.form)).not.toThrow();
		b.button.click();
		await flush();

		expect(seen).toEqual([a.button, b.button]);
		expect(nativeSubmits).toBe(0);
	});

	it('passes submits straight through once attached', async () => {
		const { attrs, key, seen } = fakeEnhance();
		const gated = holdEarlySubmits(attrs);
		expect(gated.attrs).toMatchObject({ method: 'POST', action: '?/remote=x' });
		const { form, button } = mountForm(gated);
		gated.attrs[key](form);

		button.click();

		expect(seen).toEqual([button]);
		expect(nativeSubmits).toBe(0);
	});
});
