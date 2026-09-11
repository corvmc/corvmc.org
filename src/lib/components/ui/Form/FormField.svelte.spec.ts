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
		await render(FormField, {
			field: fakeField('name'),
			type: 'text',
			label: 'Band Name',
			value: 'The Velvet Underground'
		});

		await expect.element(page.getByRole('textbox')).toHaveValue('The Velvet Underground');
	});

	it('renders an empty field-based input when no value is supplied', async () => {
		await render(FormField, {
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
		const { container } = await render(FormField, {
			name: 'coverFees',
			type: 'checkbox',
			label: '',
			checkboxLabel: 'Cover fees'
		});
		const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(input.name).toBe('b:coverFees');
	});

	it('b:-prefixes a name-only toggle so the value is a boolean', async () => {
		const { container } = await render(FormField, {
			name: 'published',
			type: 'toggle',
			label: '',
			checkboxLabel: 'Published'
		});
		const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(input.name).toBe('b:published');
	});

	it('b:-prefixes a field-based checkbox so the value is a boolean', async () => {
		const { container } = await render(FormField, {
			field: fakeField('coverFees'),
			type: 'checkbox',
			label: '',
			checkboxLabel: 'Cover fees'
		});
		const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(input.name).toBe('b:coverFees');
	});

	it('b:-prefixes a field-based toggle so the value is a boolean', async () => {
		const { container } = await render(FormField, {
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

		const { container } = await render(FormField, {
			field,
			type: 'number',
			label: 'Total Quantity',
			value: 3
		});

		const input = container.querySelector('input[type="number"]') as HTMLInputElement;
		expect(input.name).toBe('n:totalQuantity');
	});

	// Regression: `value` is destructured into its own prop, so it was not part of
	// `...rest` and the tags branch never forwarded it to TagSelect. The hidden
	// input therefore always serialised `[]`, and on the staff user page every
	// profile save posted an empty role list — silently deleting the member's
	// roles (staff/admin included) as a side effect of editing a phone number.
	it('pre-fills a tags input from the value prop', async () => {
		const { container } = await render(FormField, {
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
		const { container } = await render(FormField, {
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
			const { container } = await render(FormField, { field, type: 'file', label: 'Poster' });

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
			const { container } = await render(FormField, { field, type: 'file', label: 'Poster' });

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
			await render(FormField, { field, type: 'file', label: 'Poster', emptyLabel: 'Add a poster' });

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

			const { container } = await render(FormField, {
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
			const { container } = await render(FormField, {
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
			await render(FormField, {
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
			const { container } = await render(FormField, {
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

	// Regression: `type="select"` with `<option>` children.
	//
	// The children branch used to precede the select branch, so children won and
	// the options rendered with no `<select>` around them — bare text in a
	// fieldset, no control, and nothing to submit. Two call sites shipped that
	// way: the item Category field and `CreateLoanAction`, which meant staff
	// could not create a loan against a specific item at all.
	describe('a select whose options are children', () => {
		const options = createRawSnippet(() => ({
			render: () => `<option value="amp-1">Fender Twin</option>`
		}));

		it('renders the options inside a real select', async () => {
			const { container } = await render(FormField, {
				field: fakeField('itemId'),
				type: 'select',
				label: 'Equipment',
				children: options
			});

			const select = container.querySelector('select');
			expect(select).not.toBeNull();
			// Inside the control, not loose in the fieldset. This is the assertion
			// that fails against the old branch order.
			expect(select!.querySelectorAll('option')).toHaveLength(1);
			expect(select!.querySelector('option')!.value).toBe('amp-1');
		});

		it('submits under the field name', async () => {
			// The whole point: no `[name]` meant the field posted nothing, and the
			// handler saw an absent itemId rather than a validation error.
			const { container } = await render(FormField, {
				field: fakeField('itemId'),
				type: 'select',
				label: 'Equipment',
				children: options
			});

			expect(container.querySelector('select')!.name).toBe('itemId');
		});

		it('keeps the placeholder above children and selects it', async () => {
			const { container } = await render(FormField, {
				field: fakeField('itemId'),
				type: 'select',
				label: 'Equipment',
				placeholder: '-- Select equipment --',
				value: '',
				children: options
			});

			const select = container.querySelector('select')!;
			expect(select.options[0].textContent).toBe('-- Select equipment --');
			expect(select.value).toBe('');
		});

		it('still renders children as a custom control when no type is given', async () => {
			// Custom-input mode is not what was broken, so it must keep working.
			const { container } = await render(FormField, {
				name: 'bio',
				label: 'Bio',
				children: createRawSnippet(() => ({
					render: () => `<textarea name="bio"></textarea>`
				}))
			});

			expect(container.querySelector('textarea')).not.toBeNull();
			expect(container.querySelector('select')).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// label association
	//
	// The caption used to be a `<legend>` and nothing pointed at the control, so
	// every text, email, number, date, time and textarea field in the app was
	// unlabelled to a screen reader, and the caption was not click-to-focus.
	// A `<legend>` is still right where the field is a real group of controls;
	// these pin the single-control half.
	// -----------------------------------------------------------------------

	describe('label association', () => {
		// `as const` so each `type` stays a literal and satisfies `InputType`,
		// which the component does not export.
		const singleControl = [
			['text', 'Name'],
			['email', 'Email'],
			['tel', 'Phone'],
			['number', 'Capacity'],
			['password', 'Password'],
			['date', 'Release date'],
			['time', 'Start time'],
			['datetime-local', 'Starts'],
			['textarea', 'Description']
		] as const;

		for (const [type, label] of singleControl) {
			it(`points the caption at the control for type="${type}"`, async () => {
				const { container } = await render(FormField, { name: 'subject', type, label });

				const caption = container.querySelector('label.fieldset-legend') as HTMLLabelElement;
				expect(caption, `type="${type}" rendered no <label> caption`).not.toBeNull();
				expect(caption.textContent?.trim()).toBe(label);

				const control = container.querySelector(`#${CSS.escape(caption.htmlFor)}`);
				expect(control, `nothing carries id="${caption.htmlFor}"`).not.toBeNull();
				expect(control!.getAttribute('name')).toBe('subject');
			});
		}

		it('points the caption at the select', async () => {
			await render(FormField, {
				name: 'category',
				type: 'select',
				label: 'Category',
				options: [{ value: 'amp', label: 'Amplifier' }]
			});

			await expect.element(page.getByLabelText('Category')).toHaveValue('amp');
		});

		it('points the caption at a multi-select', async () => {
			const { container } = await render(FormField, {
				name: 'roles',
				type: 'select',
				label: 'Roles',
				multiple: true,
				value: [],
				options: [{ value: 'staff', label: 'Staff' }]
			});

			const caption = container.querySelector('label.fieldset-legend') as HTMLLabelElement;
			expect(caption).not.toBeNull();
			expect(container.querySelector('select')!.id).toBe(caption.htmlFor);
		});

		// The `input` snippet is handed `resolvedId` precisely so the caller can
		// put it on its control — that is the whole reason the parameter exists.
		it('points the caption at a custom-input control', async () => {
			const custom = createRawSnippet((id: () => string) => ({
				render: () => `<input id="${id()}" name="price" class="input" />`
			}));

			await render(FormField, { name: 'price', label: 'Price', input: custom });

			await expect.element(page.getByLabelText('Price')).toBeInTheDocument();
		});

		// A lone checkbox with no inline caption had nothing naming it at all: the
		// wrapping <label> was empty and the text sat in the <legend>.
		it('names a checkbox that has no inline label', async () => {
			await render(FormField, {
				name: 'reserveRoom',
				type: 'checkbox',
				label: 'Hold the practice room'
			});

			await expect
				.element(page.getByLabelText('Hold the practice room'))
				.toHaveAttribute('type', 'checkbox');
		});

		it('leaves a checkbox with an inline label named once, by that label', async () => {
			const { container } = await render(FormField, {
				name: 'coverFees',
				type: 'checkbox',
				label: 'Fees',
				checkboxLabel: 'Cover the processing fee'
			});

			// Two labels would concatenate into "Fees Cover the processing fee".
			expect(container.querySelector('label.fieldset-legend')).toBeNull();
			expect(container.querySelector('legend')).not.toBeNull();
			await expect.element(page.getByLabelText('Cover the processing fee')).toBeInTheDocument();
		});

		// These are groups of controls, or caller markup we never handed an id to.
		// A <label for> pointing at nothing is worse than a <legend>: it claims an
		// association that does not exist, and clicking it focuses nothing.
		const groups: Record<string, Record<string, unknown>> = {
			tags: { type: 'tags', options: [{ id: '1', label: 'admin' }], value: [] },
			calendar: { type: 'calendar', value: '' },
			'custom children': {
				children: createRawSnippet(() => ({ render: () => `<textarea name="bio"></textarea>` }))
			},
			readonly: { type: 'text', readonly: true, value: 'Fixed' }
		};

		for (const [name, props] of Object.entries(groups)) {
			it(`keeps a fieldset and legend for ${name}`, async () => {
				const { container } = await render(FormField, { name: 'thing', label: 'Thing', ...props });

				expect(container.querySelector('legend.fieldset-legend')).not.toBeNull();
				expect(container.querySelector('label.fieldset-legend')).toBeNull();
			});
		}

		it('keeps a fieldset and legend for a file field', async () => {
			const field = create_field_proxy(
				{},
				() => ({}),
				() => {},
				() => ({}),
				['posterFile']
			);
			const { container } = await render(FormField, { field, type: 'file', label: 'Poster' });

			expect(container.querySelector('legend.fieldset-legend')).not.toBeNull();
			expect(container.querySelector('label.fieldset-legend')).toBeNull();
		});
	});

	// #901: `required` reached the input as a native attribute and rendered
	// nothing. The convention was a `*` hand-typed into the label string at ten
	// call sites, so 79 other required fields were marked in code and invisible
	// on screen.
	describe('required', () => {
		it('marks the caption, and leaves the marker out of the accessible name', async () => {
			const { container } = await render(FormField, {
				name: 'phone',
				type: 'tel',
				label: 'Contact phone',
				required: true
			});

			const caption = container.querySelector('.fieldset-legend')!;
			expect(caption.textContent).toContain('Contact phone');
			const marker = caption.querySelector('span')!;
			expect(marker.textContent).toBe('*');
			expect(marker.getAttribute('aria-hidden')).toBe('true');
		});

		it('marks nothing when the field is optional', async () => {
			const { container } = await render(FormField, {
				name: 'notes',
				type: 'text',
				label: 'Notes'
			});

			expect(container.querySelector('.fieldset-legend span')).toBeNull();
		});

		it('still forwards the native attribute', async () => {
			const { container } = await render(FormField, {
				name: 'phone',
				type: 'tel',
				label: 'Contact phone',
				required: true
			});

			expect(container.querySelector('input')!.required).toBe(true);
		});
	});
});
