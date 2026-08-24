import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import FormField from './FormField.svelte';

// Minimal stand-in for a SvelteKit RemoteFormField. The real object's `.as(type, value)`
// returns the input attributes (name/value/type/aria-invalid); the second argument is
// what controls the rendered value for edit forms.
function fakeField(name: string) {
	return {
		// Mirror SvelteKit's `get_type_prefix`: a checkbox field's name is `b:`-prefixed
		// so the submitted value is coerced to a boolean.
		as: (type: string, value?: unknown) => ({
			name: type === 'checkbox' ? `b:${name}` : name,
			type,
			value: value ?? '',
			'aria-invalid': undefined
		}),
		issues: () => null
	} as never;
}

// Resolved at module scope: `@vite-ignore` means this import is never cached or
// optimised, so paying it inside the test timeout reports a cold run as a timeout.
// Same reason as commit 75fd70a.
const { create_field_proxy } = await import(
	/* @vite-ignore */ `${new URL('../../../../../node_modules/@sveltejs/kit/src/runtime/form-utils.js', import.meta.url).href}`
);

describe('FormField', () => {
	it('pre-fills a field-based text input from the value prop', async () => {
		// Regression: when both `field` and `value` were provided, the value prop was
		// dropped and the input rendered empty (band name not auto-filled).
		render(FormField, {
			field: fakeField('name'),
			type: 'text',
			label: 'Band Name',
			value: 'The Velvet Underground'
		});

		await expect.element(page.getByRole('textbox')).toHaveValue('The Velvet Underground');
	});

	it('renders an empty field-based input when no value is supplied', async () => {
		render(FormField, {
			field: fakeField('tagline'),
			type: 'text',
			label: 'Tagline'
		});

		await expect.element(page.getByRole('textbox')).toHaveValue('');
	});

	// Regression: a checkbox/toggle must submit a real boolean, which SvelteKit only
	// does when the input name carries the `b:` prefix. A string-typed schema otherwise
	// rejects the coerced boolean with "Invalid option: expected one of \"\"|\"on\"".
	it('b:-prefixes a name-only checkbox so the value is a boolean', async () => {
		const { container } = render(FormField, {
			name: 'coverFees',
			type: 'checkbox',
			label: '',
			checkboxLabel: 'Cover fees'
		});
		const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(input.name).toBe('b:coverFees');
	});

	it('b:-prefixes a name-only toggle so the value is a boolean', async () => {
		const { container } = render(FormField, {
			name: 'published',
			type: 'toggle',
			label: '',
			checkboxLabel: 'Published'
		});
		const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(input.name).toBe('b:published');
	});

	it('b:-prefixes a field-based checkbox so the value is a boolean', async () => {
		const { container } = render(FormField, {
			field: fakeField('coverFees'),
			type: 'checkbox',
			label: '',
			checkboxLabel: 'Cover fees'
		});
		const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(input.name).toBe('b:coverFees');
	});

	it('b:-prefixes a field-based toggle so the value is a boolean', async () => {
		const { container } = render(FormField, {
			field: fakeField('lookingForBand'),
			type: 'toggle',
			label: '',
			checkboxLabel: 'Looking for a band'
		});
		const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(input.name).toBe('b:lookingForBand');
	});

	// Regression: `type="number"` with a `field` prop registers as `field.as('number')`,
	// which `n:`-prefixes the name — SvelteKit then parseFloats the submitted value, so
	// the handler receives a number. Schemas declaring those fields as `z.string()`
	// rejected every submit with "expected string, received number" (equipment add/edit
	// and the staff Create Loan modal). This asserts the render half against SvelteKit's
	// own field proxy rather than the local `fakeField`, so it stays honest if kit
	// changes the prefix. The parse half is covered in equipment-number-fields.remote.spec.ts.
	it('n:-prefixes a field-based number input so the value is a number', async () => {
		const field = create_field_proxy(
			{},
			() => ({}),
			() => {},
			() => ({}),
			['totalQuantity']
		);

		const { container } = render(FormField, {
			field,
			type: 'number',
			label: 'Total Quantity',
			value: 3
		});

		const input = container.querySelector('input[type="number"]') as HTMLInputElement;
		expect(input.name).toBe('n:totalQuantity');
	});

	// Regression: `value` is destructured into its own prop, so it was not part of
	// `...rest` and the tags branch never forwarded it to TagInput. The hidden
	// input therefore always serialised `[]`, and on the staff user page every
	// profile save posted an empty role list — silently deleting the member's
	// roles (staff/admin included) as a side effect of editing a phone number.
	it('pre-fills a tags input from the value prop', async () => {
		const { container } = render(FormField, {
			name: 'roles',
			type: 'tags',
			label: 'Roles',
			multiple: true,
			options: [
				{ id: '1', label: 'admin' },
				{ id: '2', label: 'staff' },
				{ id: '3', label: 'member' }
			],
			value: ['2', '3']
		});

		const hidden = container.querySelector('input[name="roles"]') as HTMLInputElement;
		expect(JSON.parse(hidden.value)).toEqual(['2', '3']);
	});

	it('serialises an empty tags input as an empty array', async () => {
		const { container } = render(FormField, {
			name: 'roles',
			type: 'tags',
			label: 'Roles',
			multiple: true,
			options: [{ id: '1', label: 'admin' }],
			value: []
		});

		const hidden = container.querySelector('input[name="roles"]') as HTMLInputElement;
		expect(JSON.parse(hidden.value)).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// file
	//
	// SvelteKit *throws* — not warns — when a form holds an `<input type="file">`
	// without `enctype="multipart/form-data"`, and the throw happens before the
	// request is built. The visible symptom is a Save that does nothing at all,
	// which is why band and staff event posters never uploaded. `Form` sets the
	// attribute when it can see a file input; these pin the field half of it.
	// -----------------------------------------------------------------------

	describe('file (deferred upload)', () => {
		it('renders a real file input carrying the field name, so the File submits', async () => {
			const field = create_field_proxy(
				{},
				() => ({}),
				() => {},
				() => ({}),
				['posterFile']
			);
			const { container } = render(FormField, { field, type: 'file', label: 'Poster' });

			const input = container.querySelector('input[type="file"]') as HTMLInputElement;
			expect(input).not.toBeNull();
			expect(input.name).toBe('posterFile');
		});

		// A same-named hidden input alongside the file input would be submitted
		// too and clobber the File with an empty string.
		it('renders no second input under the same name', async () => {
			const field = create_field_proxy(
				{},
				() => ({}),
				() => {},
				() => ({}),
				['posterFile']
			);
			const { container } = render(FormField, { field, type: 'file', label: 'Poster' });

			expect(container.querySelectorAll('[name="posterFile"]')).toHaveLength(1);
		});

		it('offers a labelled control rather than a bare file picker', async () => {
			const field = create_field_proxy(
				{},
				() => ({}),
				() => {},
				() => ({}),
				['posterFile']
			);
			render(FormField, { field, type: 'file', label: 'Poster', emptyLabel: 'Add a poster' });

			await expect.element(page.getByText('Add a poster')).toBeInTheDocument();
		});
	});

	// -----------------------------------------------------------------------
	// readonly
	//
	// The readonly branch used to sit *after* `children` and `input`, so a field
	// in custom-input mode ignored it entirely and rendered a live, submittable
	// control to someone who was supposed to be looking, not editing.
	// -----------------------------------------------------------------------

	describe('readonly', () => {
		it('wins over a custom-input child', async () => {
			// The regression this pins: with the branch ordered `children` first,
			// this renders the live textarea and ignores `readonly` completely.
			const customInput = createRawSnippet(() => ({
				render: () => `<textarea name="bio">editable</textarea>`
			}));

			const { container } = render(FormField, {
				name: 'bio',
				label: 'Bio',
				readonly: true,
				value: 'Just looking',
				children: customInput
			});

			expect(container.querySelector('textarea')).toBeNull();
			expect(container.querySelector('[name="bio"]')).toBeNull();
			await expect.element(page.getByText('Just looking')).toBeInTheDocument();
		});

		it('renders no submittable input, so a read-only field cannot post', async () => {
			const { container } = render(FormField, {
				name: 'title',
				type: 'text',
				label: 'Title',
				readonly: true,
				value: 'Fixed'
			});

			expect(container.querySelector('[name="title"]')).toBeNull();
		});

		// A date field stores `2026-08-20` and a price stores `10.00`; neither is
		// what a person should be shown. `display` is how the caller supplies the
		// formatted form without giving up the field's identity.
		it('shows `display` instead of the raw value', async () => {
			render(FormField, {
				name: 'eventDate',
				type: 'date',
				label: 'Date',
				readonly: true,
				value: '2026-08-20',
				display: 'August 20, 2026'
			});

			await expect.element(page.getByText('August 20, 2026')).toBeInTheDocument();
		});

		it('keeps long text on its own lines rather than in a single-line input', async () => {
			const { container } = render(FormField, {
				name: 'description',
				type: 'textarea',
				label: 'Description',
				readonly: true,
				value: 'first line\nsecond line'
			});

			expect(container.querySelector('textarea')).toBeNull();
			expect(container.querySelector('.whitespace-pre-wrap')).not.toBeNull();
		});
	});
});
