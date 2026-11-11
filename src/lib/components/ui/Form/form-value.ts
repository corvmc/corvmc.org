/**
 * A remote form field's current value, read from the form by key.
 *
 * Kit names each field `<key>/<form id>`, with an `n:`, `b:` or `i:` prefix on a
 * typed one, so `FormData.get('date')` is always null for a remote form. A step
 * that reads an earlier step's values goes through this instead.
 */
export function formValue(form: HTMLFormElement | FormData, key: string): string | null {
	// eslint-disable-next-line no-restricted-syntax -- the one place a form's FormData is read
	const data = form instanceof FormData ? form : new FormData(form);
	for (const [name, value] of data) {
		if (typeof value !== 'string') continue;
		if (name.replace(/^[nbi]:/, '').replace(/\/[^/]*$/, '') === key) return value;
	}
	return null;
}
