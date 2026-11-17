import { describe, expect, it } from 'vitest';
import { holdEarlySubmits } from './hold-early-submit.js';

// The shape kit's `form.enhance()` returns: plain attributes plus a symbol-keyed
// attachment that adds the submit listener.
function fakeEnhance(onsubmit: (e: SubmitEvent) => void) {
	const key = Symbol('attachment');
	const attrs = {
		method: 'POST',
		action: '?/remote=x',
		[key]: (form: HTMLFormElement) => {
			form.addEventListener('submit', onsubmit);
			return () => form.removeEventListener('submit', onsubmit);
		}
	};
	return { attrs, attach: (a: typeof attrs, form: HTMLFormElement) => a[key](form) };
}

function mountForm() {
	const form = document.createElement('form');
	const button = document.createElement('button');
	button.type = 'submit';
	form.append(button);
	document.body.append(form);
	return { form, button };
}

describe('holdEarlySubmits', () => {
	it('holds a submit made before the attachment runs, then replays it', async () => {
		const seen: (Element | null)[] = [];
		const { attrs, attach } = fakeEnhance((e) => {
			e.preventDefault();
			seen.push(e.submitter);
		});
		const gated = holdEarlySubmits(attrs);
		const { form, button } = mountForm();
		form.addEventListener('submit', (e) => void gated.hold(e), { capture: true });
		// On the document, so it runs after every listener on the form itself.
		let nativeSubmits = 0;
		const count = (e: Event) => {
			if (!e.defaultPrevented) nativeSubmits++;
			e.preventDefault();
		};
		document.addEventListener('submit', count);

		button.click();
		expect(seen).toEqual([]);

		attach(gated.attrs, form);
		await Promise.resolve();

		expect(seen).toEqual([button]);
		expect(nativeSubmits).toBe(0);
		document.removeEventListener('submit', count);
		form.remove();
	});

	it('passes submits through once attached and keeps the plain attributes', () => {
		const { attrs, attach } = fakeEnhance((e) => e.preventDefault());
		const gated = holdEarlySubmits(attrs);
		expect(gated.attrs).toMatchObject({ method: 'POST', action: '?/remote=x' });
		const { form, button } = mountForm();
		attach(gated.attrs, form);
		let held = false;
		form.addEventListener('submit', (e) => (held = gated.hold(e)), { capture: true });
		form.addEventListener('submit', (e) => e.preventDefault());
		button.click();
		expect(held).toBe(false);
		form.remove();
	});
});
