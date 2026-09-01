<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	import FormField from './FormField.svelte';

	/**
	 * Money in dollars, money out in cents.
	 *
	 * The ledger stores integer cents, so every price field on a form used to ask
	 * the operator to do the conversion — "Unit cost (cents)", into which a
	 * reasonable person types `45` for a $45 cable and records 45¢. During a
	 * stocktake that is a few hundred chances to be off by a factor of a hundred,
	 * and nothing downstream can tell a cheap cable from a mistyped one.
	 *
	 * The visible input is dollars and is not the field: a hidden sibling carries
	 * the cents, registered as a number so SvelteKit coerces it (`n:` prefix)
	 * rather than handing the schema a string. Clearing the box clears the hidden
	 * value, which SvelteKit then drops from the payload entirely — so an empty
	 * price arrives as `undefined`, which is what an optional cost should mean.
	 *
	 * Extracted from the hand-rolled copy in `staff/settings/+page.svelte`, which
	 * had to declare its schema as a digits-only *string* and parse it in the
	 * handler for want of this.
	 */
	let {
		field,
		label,
		value = undefined,
		description,
		...rest
	}: {
		// FormField's own `field?: RemoteFormField<any>`; narrowing it here would
		// reject every caller's concrete field type.
		field: RemoteFormField<any>;
		label?: string;
		/** Existing amount, in cents. */
		value?: number | null;
		description?: string;
		/** `id` and anything else flow through to `FormField` via `...rest`. */
		[key: string]: unknown;
	} = $props();

	/**
	 * What the operator has typed, or `null` while they have typed nothing.
	 *
	 * The displayed value is derived rather than seeded into `$state`, so a
	 * `value` that arrives late — every edit form here reads it off an awaited
	 * query — still fills the box, and the moment somebody types, their text
	 * wins and later prop changes stop overwriting it mid-edit.
	 */
	let typed = $state<string | null>(null);

	const dollars = $derived(typed ?? (value == null ? '' : (value / 100).toFixed(2)));

	/**
	 * `''` rather than `'0'` when the box is empty or nonsense: an absent price
	 * and a price of zero are different claims, and only one of them is a claim.
	 */
	const cents = $derived.by(() => {
		if (dollars.trim() === '') return '';
		const parsed = Number.parseFloat(dollars);
		return Number.isFinite(parsed) ? String(Math.round(parsed * 100)) : '';
	});
</script>

<FormField {label} {description} issues={field.issues() ?? null} {...rest}>
	{#snippet input(id)}
		<label class="input w-full items-center gap-1">
			<span class="opacity-60">$</span>
			<input
				{id}
				type="number"
				step="0.01"
				min="0"
				inputmode="decimal"
				class="grow bg-transparent outline-none"
				value={dollars}
				oninput={(e) => (typed = e.currentTarget.value)}
			/>
		</label>
		<!-- `type` last: `.as('number')` sets the `n:` name prefix that makes
		     SvelteKit coerce this, but it also sets `type="number"`, which would
		     render a second visible spinner. -->
		<input {...field.as('number', cents)} type="hidden" />
	{/snippet}
</FormField>
