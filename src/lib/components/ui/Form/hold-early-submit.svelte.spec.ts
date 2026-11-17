import { afterEach, describe, expect, it } from 'vitest';
import { holdEarlySubmits, holdIfNotEnhanced } from './hold-early-submit.js';

type Attach = (form: HTMLFormElement) => (() => void) | void;

// The shape kit's `form.enhance()` returns: plain attributes plus a symbol-keyed
// attachment that adds the submit listener.
function fakeEnhance() {
	const seen: (Element | null)[] = [];
	const onsubmit = (e: SubmitEvent) => {
		e.preventDefault();
		seen.push(e.submitter);
	};
	const key = Symbol('@attach');
	const attrs = {
		method: 'POST',
		action: '?/remote=x',
		[key]: (form: HTMLFormElement) => {
			form.addEventListener('submit', onsubmit);
			return () => form.removeEventListener('submit', onsubmit);
		}
	};
	return { attrs, key, seen };
}

/** Runs the symbol-keyed attachment, as Svelte's spread would. */
function runAttachment(attrs: object, key: symbol, form: HTMLFormElement) {
	return (attrs as Record<symbol, Attach>)[key](form);
}

let nativeSubmits = 0;
// On the document, so it runs after every listener on the form itself.
document.addEventListener('submit', (e) => {
	if (!e.defaultPrevented) nativeSubmits++;
	e.preventDefault();
});
afterEach(() => {
	nativeSubmits = 0;
	document.body.replaceChildren();
});

function mountForm() {
	const form = document.createElement('form');
	const button = document.createElement('button');
	button.type = 'submit';
	form.appendChild(button);
	document.body.appendChild(form);
	// Stands in for Form.svelte's `onsubmitcapture`.
	form.addEventListener('submit', (e) => void holdIfNotEnhanced(e), { capture: true });
	return { form, button };
}

describe('holdEarlySubmits', () => {
	it('holds a submit made before the attachment runs, then replays it', async () => {
		const { attrs, key, seen } = fakeEnhance();
		const { form, button } = mountForm();

		button.click();
		expect(seen).toEqual([]);

		runAttachment(holdEarlySubmits(attrs), key, form);
		await Promise.resolve();

		expect(seen).toEqual([button]);
		expect(nativeSubmits).toBe(0);
	});

	it('treats the form as enhanced whichever wrapper attached it', () => {
		const { attrs, key, seen } = fakeEnhance();
		const { form, button } = mountForm();
		runAttachment(holdEarlySubmits(attrs), key, form);
		// A second wrapper of the same attributes, never attached.
		holdEarlySubmits(attrs);

		button.click();

		expect(seen).toEqual([button]);
		expect(nativeSubmits).toBe(0);
	});

	it('holds again after the attachment is torn down', () => {
		const { attrs, key, seen } = fakeEnhance();
		const { form, button } = mountForm();
		const teardown = runAttachment(holdEarlySubmits(attrs), key, form);
		teardown?.();

		button.click();

		expect(seen).toEqual([]);
		expect(nativeSubmits).toBe(0);
	});

	it('keeps the plain attributes', () => {
		const { attrs } = fakeEnhance();
		expect(holdEarlySubmits(attrs)).toMatchObject({ method: 'POST', action: '?/remote=x' });
	});
});
