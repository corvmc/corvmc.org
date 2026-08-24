<script lang="ts">
	import { type Snippet } from 'svelte';
	import type { RemoteFormField, RemoteFormIssue } from '@sveltejs/kit';
	import TagInput from './TagInput.svelte';
	import CalendarSelect from './CalendarSelect.svelte';
	import Select from './Select.svelte';
	import FileUpload from './FileUpload.svelte';
	import { getFormContext } from './Form.svelte';
	import { IconPencilOff } from '@tabler/icons-svelte';

	type InputType =
		| 'text'
		| 'email'
		| 'tel'
		| 'number'
		| 'password'
		| 'date'
		| 'time'
		| 'datetime-local'
		| 'textarea'
		| 'select'
		| 'tags'
		| 'checkbox'
		| 'toggle'
		| 'file'
		| 'calendar';

	let {
		label,
		name,
		id: propId,
		type,
		field,
		class: className = '',
		input,
		description,
		readonly,
		display,
		issues: propIssues,
		children,
		upload,
		accept,
		src,
		value = $bindable(),
		...rest
	}: {
		name?: string;
		id?: string;
		label?: string;
		field?: RemoteFormField<any>;
		input?: Snippet<[id: string]>;
		children?: Snippet;
		/** Hint under the label. A snippet when the hint needs an inline link. */
		description?: string | Snippet;
		type?: InputType;
		class?: string;
		value?: any;
		readonly?: boolean;
		/**
		 * What to show in place of the input when `readonly`. Without it the
		 * readonly branch prints `value` raw, which is the wrong thing for
		 * anything the form stores differently from how a person reads it — a
		 * date is `2026-08-20`, a time is `19:30`, a price is `10.00`. Pass a
		 * string for a formatted scalar, or a snippet when the value is a link,
		 * a list, or anything else with structure.
		 */
		display?: string | Snippet;
		issues?: RemoteFormIssue[] | null;
		upload?: (file: File) => Promise<string>;
		accept?: string;
		src?: string;
		[key: string]: any;
	} = $props();

	const form = getFormContext();

	const uid = Math.random().toString(16).slice(2, 8);
	let _name = $derived(name ?? propId ?? '');
	let _id = $derived(propId ?? `form-field-${_name}-${uid}`);
	let _label = $derived.by(
		() => label ?? (_name ? _name.slice(0, 1).toUpperCase() + _name.slice(1) : '')
	);

	// These types render `value` themselves (bind:value / bind:checked / select) and
	// only use fieldAttrs for the resolved name, so we don't forward value into `.as()`.
	let ownsValue = $derived(
		type === 'textarea' ||
			type === 'tags' ||
			type === 'calendar' ||
			type === 'toggle' ||
			type === 'checkbox' ||
			type === 'select' ||
			type === 'file'
	);

	// Both `checkbox` and `toggle` render an `<input type="checkbox">`, so they must
	// register with SvelteKit as a checkbox. That gives the field name a `b:` prefix,
	// which makes the submitted value a real boolean (`'on'` → true, unchecked → absent
	// → false via the schema default) instead of the string "on".
	let isBooleanInput = $derived(type === 'checkbox' || type === 'toggle');

	// Resolve field attributes from SvelteKit field definition when provided
	let fieldAttrs = $derived.by(() => {
		if (!field) return null;
		// `file` maps to itself: a deferred upload submits a real File on a real
		// file input, and `.as('text')` would register the field as a string and
		// hand the handler the filename instead. The other three are text under
		// the hood — a textarea, a JSON blob, a date string.
		const asType = isBooleanInput
			? 'checkbox'
			: type === 'file'
				? 'file'
				: type === 'textarea' || type === 'tags' || type === 'calendar'
					? 'text'
					: (type ?? 'text');
		// Forward the supplied value so plain inputs render pre-filled from existing
		// data (edit forms). `.as(type, value)` controls the rendered value.
		// A file field has no renderable value to forward — the browser owns it.
		return ownsValue || value === undefined || asType === 'file'
			? field.as(asType as any)
			: field.as(asType as any, value);
	});

	// When field is provided, `fieldAttrs.name` already carries the `b:` prefix. For
	// name-only boolean inputs (no `field`), apply the prefix manually so SvelteKit
	// still coerces the value to a boolean.
	let resolvedName = $derived(fieldAttrs?.name ?? (isBooleanInput ? `b:${_name}` : _name));
	let resolvedId = $derived(
		propId ?? (fieldAttrs?.name ? `form-field-${fieldAttrs.name}-${uid}` : _id)
	);

	// Issues: field.issues() > propIssues > form context
	let issues = $derived.by(() => {
		if (field) return field.issues() ?? null;
		if (form) return form.issuesFor(_name);
		return propIssues ?? null;
	});

	let pending = $derived(form ? form.status === 'pending' : false);

	let inputProps = $derived({
		id: resolvedId,
		name: resolvedName,
		type,
		disabled: pending || readonly,
		...(fieldAttrs ? { 'aria-invalid': fieldAttrs['aria-invalid'] } : {})
	});

	// `<select>` has no `type` attribute — forward everything else.
	let selectProps = $derived.by(() => {
		const { type: _type, ...props } = inputProps;
		return props;
	});
</script>

<fieldset
	class="fieldset {className}"
	oninput={() => form?.changed()}
	onchange={() => form?.changed()}
>
	<legend class="fieldset-legend">
		{_label}
	</legend>
	{#if issues}
		{#each issues as issue (issue.message)}
			<p class="text-sm text-error">{issue.message}</p>
		{/each}
	{:else if typeof description === 'string'}
		<p class="text-muted text-sm">{description}</p>
	{:else if description}
		<p class="text-muted text-sm">{@render description()}</p>
	{/if}
	<!--
		`readonly` comes first on purpose. It used to sit after `children` and
		`input`, which meant it was silently ignored on every field using
		custom-input mode — exactly the fields that need it most (a long
		description, a chip editor, a file input). A read-only field also renders
		no `[name]` input at all, so it cannot post.
	-->
	{#if readonly}
		{#if typeof display !== 'string' && display}
			<div class="input h-auto min-h-12 w-full items-start py-3">
				<div class="grow whitespace-pre-wrap">{@render display()}</div>
				<IconPencilOff class="size-5 shrink-0 opacity-20" />
			</div>
		{:else if type === 'textarea'}
			<div class="input h-auto min-h-12 w-full items-start py-3">
				<span class="grow whitespace-pre-wrap">{display ?? value}</span>
				<IconPencilOff class="size-5 shrink-0 opacity-20" />
			</div>
		{:else}
			<p class="input w-full">
				<span class="grow">{display ?? value}</span>
				<IconPencilOff class="size-5 opacity-20" />
			</p>
		{/if}
	{:else if children}
		{@render children()}
	{:else if input}
		{@render input(resolvedId)}
	{:else if type === 'textarea'}
		<textarea class="textarea w-full" class:ghost={readonly} {...inputProps} bind:value></textarea>
	{:else if type === 'tags'}
		<!-- `value` is its own prop, so it is not in `...rest` and must be forwarded
		     explicitly — without it TagInput starts empty and submits `[]`. -->
		<TagInput {...rest} options={rest.options} {...inputProps} {value} disabled={pending} />
	{:else if type === 'calendar'}
		<CalendarSelect {...rest} name={resolvedName} bind:value disabled={pending || readonly} />
	{:else if type === 'checkbox'}
		<label class="label cursor-pointer gap-2 items-center">
			<input
				type="checkbox"
				class="checkbox shrink-0"
				bind:checked={value}
				disabled={pending || readonly}
				id={resolvedId}
				name={resolvedName}
			/>
			{#if rest.checkboxLabel}<span class="text-wrap">{rest.checkboxLabel}</span>{/if}
		</label>
	{:else if type === 'toggle'}
		<label class="label cursor-pointer gap-2">
			<input
				type="checkbox"
				class="toggle"
				bind:checked={value}
				disabled={pending || readonly}
				id={resolvedId}
				name={resolvedName}
			/>
			{#if rest.checkboxLabel}<span>{rest.checkboxLabel}</span>{/if}
		</label>
	{:else if type === 'file' && (upload || field)}
		<!-- Two modes. With `upload`, the file posts immediately and the returned
		     key is what submits (a band avatar). With a remote `field` and no
		     `upload`, the File rides this form — which is the only option when the
		     record it belongs to does not exist yet. -->
		<FileUpload
			name={resolvedName}
			{upload}
			inputProps={upload ? undefined : (fieldAttrs ?? undefined)}
			{accept}
			{value}
			{src}
			orientation={rest.orientation}
			previewClass={rest.previewClass}
			emptyLabel={rest.emptyLabel}
			replaceLabel={rest.replaceLabel}
			disabled={pending || readonly}
		/>
	{:else if type === 'select' && rest.multiple}
		<input
			type="hidden"
			name={resolvedName}
			value={JSON.stringify(Array.isArray(value) ? value : [])}
		/>
		<select
			class="select w-full"
			class:ghost={readonly}
			multiple
			disabled={pending || readonly}
			id={resolvedId}
			onchange={(e) => {
				const sel = e.currentTarget;
				value = Array.from(sel.selectedOptions, (o) => o.value);
				const hidden = sel.previousElementSibling as HTMLInputElement;
				hidden.value = JSON.stringify(value);
			}}
		>
			{#each rest.options as option (option.value)}
				<option
					value={option.value}
					selected={Array.isArray(value) && value.includes(option.value)}
				>
					{option.label}
				</option>
			{/each}
		</select>
	{:else if type === 'select'}
		<Select class="w-full {readonly ? 'ghost' : ''}" {...selectProps} bind:value>
			{#if rest.placeholder}
				<option value="">{rest.placeholder}</option>
			{/if}
			{#each rest.options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</Select>
	{:else if field && fieldAttrs}
		<input
			class="input w-full"
			class:ghost={readonly}
			{...rest}
			{...fieldAttrs}
			id={resolvedId}
			disabled={pending || readonly}
		/>
	{:else}
		<input class="input w-full" class:ghost={readonly} {...rest} {...inputProps} bind:value />
	{/if}
</fieldset>
