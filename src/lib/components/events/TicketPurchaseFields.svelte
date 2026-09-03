<script lang="ts">
	// The money half of the ticket purchase form: how much, and where it goes.
	// Shared by the public checkout page and the member event page. Both surfaces
	// charge through the same remote, so the arithmetic they preview has to be the
	// same arithmetic — kept in one component rather than written twice and
	// drifting, and computed by the same module the server re-derives with.
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { Field } from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import SplitBar from '$lib/components/ui/SplitBar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { formatCents } from '$lib/utils/format';
	import { computeTicketSplit, suggestedCollectiveCents } from '$lib/finance/ticket-split';
	import { TICKET_MIN_CHARGE_CENTS } from '$lib/config';
	import type { RemoteFormField, RemoteFormFieldValue } from '@sveltejs/kit';

	let {
		/** The event's suggested price in cents — where the scale opens. */
		suggestedUnitCents,
		/** The least a buyer may pay per ticket. 0 runs the scale to free. */
		floorCents,
		quantity,
		/** The names on the bill, for the split bar's label. */
		acts = [],
		collectiveShareBps,
		fields,
		/**
		 * Render the submit button here. The public checkout page wants it — only
		 * this component knows what the card is charged, and that number is the
		 * button's label. The member page mounts these fields inside an `Action`
		 * modal, which brings its own button, so it turns this off and reads
		 * `chargeCents`/`blocked` instead.
		 */
		submit = true,
		chargeCents = $bindable(0),
		blocked = $bindable(false)
	}: {
		suggestedUnitCents: number;
		floorCents: number;
		quantity: number;
		acts?: string[];
		collectiveShareBps: number;
		/** `purchaseTickets.fields` — the two hidden amounts are rendered here. */
		fields: {
			unitPriceCents: RemoteFormField<RemoteFormFieldValue>;
			collectiveCents: RemoteFormField<RemoteFormFieldValue>;
		};
		submit?: boolean;
		/** What the card will be charged. Read-only to the parent. */
		chargeCents?: number;
		/** True while the amount is one the remote will refuse. */
		blocked?: boolean;
	} = $props();

	// Both are `null` until touched, and read through a `$derived` fallback rather
	// than `$state` seeded from a prop. SvelteKit reuses this component across a
	// change of `[id]`, and seeded state would carry one show's price onto the
	// next one.
	let typedAmount = $state<string | null>(null);
	let collectiveOverride = $state<number | null>(null);
	let coverFees = $state(false);

	const unitCents = $derived.by(() => {
		if (typedAmount === null) return suggestedUnitCents;
		const parsed = Number.parseFloat(typedAmount);
		// Unparseable previews as nothing rather than as a guess; the remote
		// rejects it on submit with a field issue.
		return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
	});
	const amountDollars = $derived(typedAmount ?? (suggestedUnitCents / 100).toFixed(2));
	const totalCents = $derived(unitCents * quantity);

	// Computed twice on purpose: once at the current allocation, and once as if
	// fees were covered, so the checkbox can quote its own surcharge before it is
	// ticked.
	const atZero = $derived(
		computeTicketSplit({
			unitPriceCents: unitCents,
			quantity,
			collectiveCents: 0,
			coverFees,
			suggestedUnitCents
		})
	);
	const divisibleCents = $derived(atZero.chargeCents - atZero.stripeFeeCents);
	const collective = $derived(
		collectiveOverride ?? suggestedCollectiveCents(divisibleCents, collectiveShareBps)
	);
	const split = $derived(
		computeTicketSplit({
			unitPriceCents: unitCents,
			quantity,
			collectiveCents: Math.min(collective, Math.max(0, divisibleCents)),
			coverFees,
			suggestedUnitCents
		})
	);
	const covered = $derived(
		computeTicketSplit({
			unitPriceCents: unitCents,
			quantity,
			collectiveCents: 0,
			coverFees: true,
			suggestedUnitCents
		})
	);

	const actsLabel = $derived(acts.length === 1 ? acts[0] : 'The acts');
	// Free only when free is actually on offer. On a show with a floor, $0 is a
	// refused amount, and labelling the (disabled) button "Get ticket" beside an
	// error saying the minimum is $5 reads as a contradiction.
	const isFree = $derived(totalCents === 0 && floorCents === 0);
	// The gap between free and Stripe's charge minimum, where card fees would take
	// almost everything. Named on the page rather than only on submit.
	const inDeadZone = $derived(totalCents > 0 && totalCents < TICKET_MIN_CHARGE_CENTS);
	const belowFloor = $derived(unitCents < floorCents);

	// Preset amounts, built off the suggestion and filtered to what this show
	// allows. De-duplicated, because a floor equal to the suggested price collapses
	// every one of them onto the same number.
	$effect(() => {
		chargeCents = split.chargeCents;
		blocked = inDeadZone || belowFloor;
	});

	const presets = $derived(
		[
			...new Set([
				floorCents,
				Math.round(suggestedUnitCents / 2),
				suggestedUnitCents,
				suggestedUnitCents * 2
			])
		]
			.filter((c) => c >= floorCents && (c === 0 || c >= TICKET_MIN_CHARGE_CENTS))
			.sort((a, b) => a - b)
	);
</script>

<FormField
	label="How much are you paying?"
	id="ticketAmount"
	description={floorCents === 0
		? `Suggested ${formatCents(suggestedUnitCents)} a ticket — pay what you can, from $0.`
		: `Suggested ${formatCents(suggestedUnitCents)} a ticket, ${formatCents(floorCents)} minimum.`}
	issues={[]}
>
	<label class="input w-full items-center gap-1">
		<span class="opacity-60">$</span>
		<input
			id="ticketAmount"
			type="number"
			step="0.01"
			min="0"
			inputmode="decimal"
			class="grow bg-transparent outline-none"
			value={amountDollars}
			oninput={(e) => (typedAmount = e.currentTarget.value)}
		/>
		<span class="text-muted text-sm whitespace-nowrap">per ticket</span>
	</label>
</FormField>

<div class="flex flex-wrap gap-2">
	{#each presets as preset (preset)}
		<Button
			type="button"
			variant={unitCents === preset ? 'primary' : 'ghost'}
			size="sm"
			onclick={() => (typedAmount = (preset / 100).toFixed(2))}
		>
			{preset === 0 ? 'Free' : formatCents(preset)}
		</Button>
	{/each}
</div>

{#if quantity > 1}
	<p class="text-muted text-sm">
		{quantity} × {formatCents(unitCents)} =
		<span class="font-medium">{formatCents(totalCents)}</span>
	</p>
{/if}

{#if belowFloor}
	<p class="text-sm text-error">
		The least you can pay for this show is {formatCents(floorCents)} a ticket.
	</p>
{:else if inDeadZone}
	<p class="text-sm text-error">
		Pay nothing, or at least {formatCents(TICKET_MIN_CHARGE_CENTS)} — below that, card fees take almost
		all of it.
	</p>
{/if}

{#if !isFree && !inDeadZone && !belowFloor}
	<div class="space-y-3 border-t border-base-200 pt-4">
		<p class="font-medium">Where should it go?</p>
		<!-- No `otherFloorCents`. Passing the price floor there is the bug fixed in
		     the music BuyPanel: it consumed the whole amount, clamped the
		     collective's share to zero, and the suggested position never appeared.
		     The acts' protection is the total the buyer named, not a floor on the
		     bar. -->
		<SplitBar
			{totalCents}
			value={split.collectiveCents}
			onchange={(c) => (collectiveOverride = c)}
			fixedCents={split.stripeFeeCents}
			fixedLabel="Card processing"
			valueLabel="The Collective"
			otherLabel={actsLabel}
		/>

		<!-- `label=""` because FormField titles itself off the field name otherwise,
		     and "CoverFees" above a sentence that already says what the box does is
		     noise. -->
		<Field
			name="coverFees"
			type="checkbox"
			label=""
			bind:value={coverFees}
			checkboxLabel="Add {formatCents(
				covered.feeCoveredCents
			)} to cover card processing, so {actsLabel} and the Collective keep the full {formatCents(
				totalCents
			)}"
		/>

		{#if collectiveOverride !== null}
			<Button type="button" variant="ghost" size="sm" onclick={() => (collectiveOverride = null)}>
				Reset to suggested
			</Button>
		{/if}
	</div>
{/if}

<!-- The two figures the buyer chose. The server re-derives the whole split from
     the event's own price and floor and trusts neither of these — they exist so
     the choices survive the round trip, not as an authority on them. `n:` via
     `.as('number', …)`, so SvelteKit coerces them rather than handing the schema
     a string. -->
<input {...fields.unitPriceCents.as('number', String(unitCents))} type="hidden" />
<input
	{...fields.collectiveCents.as('number', String(isFree ? 0 : split.collectiveCents))}
	type="hidden"
/>

<div class="space-y-1 border-t border-base-200 pt-4">
	<div class="flex justify-between text-muted">
		<span
			>{quantity} × {formatCents(split.ticketLineUnitCents)} ticket{quantity === 1 ? '' : 's'}</span
		>
		<span>{formatCents(split.ticketLineUnitCents * quantity)}</span>
	</div>
	{#if split.contributionCents > 0}
		<div class="flex justify-between text-muted">
			<span>Contribution</span>
			<span>{formatCents(split.contributionCents)}</span>
		</div>
	{/if}
	{#if coverFees && split.feeCoveredCents > 0}
		<div class="flex justify-between text-muted">
			<span>Card processing</span>
			<span>{formatCents(split.feeCoveredCents)}</span>
		</div>
	{/if}
	<div class="flex justify-between text-lg font-medium">
		<span>Total</span>
		<span>{formatCents(split.chargeCents)}</span>
	</div>
</div>

{#if submit}
	<SubmitButton
		label={isFree
			? `Get ${quantity === 1 ? 'ticket' : `${quantity} tickets`}`
			: `Pay ${formatCents(split.chargeCents)}`}
		variant="primary"
		class="w-full"
		disabled={inDeadZone || belowFloor}
	/>
{/if}
