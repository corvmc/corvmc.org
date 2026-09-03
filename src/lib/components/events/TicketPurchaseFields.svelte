<script lang="ts">
	// The money half of the ticket purchase form, shared by the public checkout
	// page and the member event page. Both surfaces charge through the same
	// remote, so the arithmetic they preview has to be the same arithmetic — kept
	// in one component rather than written twice and drifting.
	import { Field } from '$lib/components/ui/Form';
	import Button from '$lib/components/ui/Button.svelte';
	import { formatCents, formatDollars } from '$lib/utils/format';
	import { calculateTotalWithFeeCoverage } from '$lib/finance/fees';
	import { contributionToCents } from '$lib/utils/event-ticketing';
	import { TICKET_CONTRIBUTION_PRESETS } from '$lib/config';

	let {
		/** The event's full ticket price in cents, before any member discount. */
		fullPrice,
		quantity,
		isSustainingMember = false
	}: {
		fullPrice: number;
		quantity: number;
		isSustainingMember?: boolean;
	} = $props();

	let coverFees = $state(false);
	let waiveDiscount = $state(false);
	let contribution = $state('');

	const discountApplied = $derived(isSustainingMember && !waiveDiscount);
	const unitPrice = $derived(discountApplied ? Math.round(fullPrice / 2) : fullPrice);
	const ticketSubtotal = $derived(unitPrice * quantity);
	const discountCents = $derived(discountApplied ? fullPrice * quantity - ticketSubtotal : 0);

	// An unparseable amount previews as nothing rather than as a guess; the remote
	// rejects it on submit with a field issue.
	const contributionCents = $derived(contributionToCents(contribution) ?? 0);

	// Fees are charged on everything Stripe collects, the gift included — leaving
	// it out here would show a total the card statement disagrees with.
	const feeBase = $derived(ticketSubtotal + contributionCents);
	const feeCents = $derived(calculateTotalWithFeeCoverage(feeBase).feeCents);
	const total = $derived(feeBase + (coverFees ? feeCents : 0));
</script>

<Field
	name="contribution"
	type="text"
	inputmode="decimal"
	label="Add a contribution (optional)"
	description="Goes to the acts on the bill and to keeping the room open."
	bind:value={contribution}
/>

<div class="flex flex-wrap gap-2">
	{#each TICKET_CONTRIBUTION_PRESETS as preset (preset)}
		<Button
			type="button"
			variant={contributionCents === preset ? 'primary' : 'ghost'}
			size="sm"
			onclick={() => (contribution = contributionCents === preset ? '' : formatDollars(preset))}
		>
			{formatCents(preset)}
		</Button>
	{/each}
</div>

{#if isSustainingMember}
	<Field
		name="waiveDiscount"
		type="checkbox"
		bind:value={waiveDiscount}
		checkboxLabel="Pay full price — skip my 50% member discount"
	/>
{/if}

<Field
	name="coverFees"
	type="checkbox"
	bind:value={coverFees}
	checkboxLabel="Add {formatCents(
		feeCents
	)} to cover processing fees so the collective receives the full amount"
/>

<div class="space-y-1 border-t border-base-200 pt-4">
	<!-- Priced at the list rate with the discount as its own deduction below. The
	     line and the deduction have to describe the same money once, not twice. -->
	<div class="flex justify-between text-muted">
		<span>{quantity} × {formatCents(fullPrice)} ticket{quantity === 1 ? '' : 's'}</span>
		<span>{formatCents(fullPrice * quantity)}</span>
	</div>
	{#if discountCents > 0}
		<div class="flex justify-between text-success">
			<span>Sustaining member discount</span>
			<span>−{formatCents(discountCents)}</span>
		</div>
	{/if}
	{#if contributionCents > 0}
		<div class="flex justify-between text-muted">
			<span>Contribution</span>
			<span>{formatCents(contributionCents)}</span>
		</div>
	{/if}
	{#if coverFees}
		<div class="flex justify-between text-muted">
			<span>Processing fees</span>
			<span>{formatCents(feeCents)}</span>
		</div>
	{/if}
	<div class="flex justify-between text-lg font-medium">
		<span>Total</span>
		<span>{formatCents(total)}</span>
	</div>
	{#if isSustainingMember && waiveDiscount}
		<p class="text-muted text-sm">
			Paying full price. Thank you — the difference goes straight to the show.
		</p>
	{/if}
</div>
