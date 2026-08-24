<script lang="ts">
	/**
	 * A multi-select bound to an **array** field on a remote form.
	 *
	 * `FormField type="checkbox"` is a different thing: it renders one box for one
	 * boolean, and registers with a `b:` name prefix so SvelteKit coerces `'on'` to
	 * `true`. An array field instead wants one box per option, all sharing the
	 * field, each carrying its own value — which is what `field.as('checkbox',
	 * value)` produces.
	 *
	 * When nothing is checked the browser submits no entry at all, so the schema
	 * behind the field must default to `[]` rather than requiring one selection.
	 * Otherwise "untick everything and save" fails validation instead of clearing.
	 */
	import type { Snippet } from 'svelte';

	type Option = {
		value: string;
		label: string;
		/** Rendered under the label. Pre-sanitized HTML — see `descriptionHtml`. */
		description?: string | null;
	};

	let {
		field,
		options,
		selected = [],
		legend,
		description,
		descriptionHtml = false,
		children
	}: {
		/** A form field from `remote.fields.<name>`, whose schema type is an array. */
		field: { as: (type: 'checkbox', value: string) => Record<string, unknown> };
		options: Option[];
		/**
		 * Values to start checked. Applied as a plain `checked` attribute after the
		 * field's own attributes, so it sets the box's initial state and then gets
		 * out of the way — the inputs stay uncontrolled and the user can toggle
		 * freely without anything fighting them back.
		 */
		selected?: string[];
		legend?: string;
		description?: string;
		/**
		 * Treat each option's `description` as HTML rather than text. Only pass this
		 * for markup the server rendered and sanitized — role descriptions come
		 * through `renderMarkdown`, which does both.
		 */
		descriptionHtml?: boolean;
		children?: Snippet;
	} = $props();
</script>

<!--
	The legend is the category heading over a stack of option cards, so it needs
	clear air under it and between groups — with only the fieldset's own gap it
	reads as another row in the list rather than a label for the ones below.
-->
<fieldset class="flex flex-col gap-2 not-first:mt-6">
	{#if legend}
		<legend class="mb-3 font-medium">{legend}</legend>
	{/if}
	{#if description}
		<p class="text-muted">{description}</p>
	{/if}

	{#each options as option (option.value)}
		<label class="flex cursor-pointer items-start gap-3 rounded-box bg-base-200 p-3">
			<input
				{...field.as('checkbox', option.value)}
				checked={selected.includes(option.value)}
				class="checkbox checkbox-sm mt-0.5 shrink-0"
			/>
			<span class="min-w-0">
				<span class="font-medium">{option.label}</span>
				{#if option.description}
					{#if descriptionHtml}
						<span class="prose prose-sm block max-w-none text-base-content/70">
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- caller's contract: server-rendered and sanitized -->
							{@html option.description}
						</span>
					{:else}
						<span class="block text-sm text-base-content/70">{option.description}</span>
					{/if}
				{/if}
			</span>
		</label>
	{/each}

	{@render children?.()}
</fieldset>
