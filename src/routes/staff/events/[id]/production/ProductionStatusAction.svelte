<script lang="ts">
	/**
	 * Move a production one step along.
	 *
	 * Page-local rather than in `$lib/components/actions/`: one page uses it, and
	 * the registry is for actions several surfaces reach for.
	 *
	 * Only the four transitions this phase can drive are offered. `settled` and
	 * `closed` exist in the machine and in `StatusBadge`, but the settlement
	 * worksheet and the close-out are later phases and there is nothing here that
	 * could honestly produce either — a button that sets a status without doing
	 * the work it names is worse than no button.
	 */
	import Action from '$lib/components/ui/Action.svelte';
	import { advanceProduction } from '$lib/remote/productions.remote';
	import type { ProductionStatus } from '$lib/server/db/schema/production';

	let {
		production,
		eventId
	}: {
		production: { id: string; status: ProductionStatus };
		eventId: string;
	} = $props();

	const { fields } = advanceProduction;

	/** Forward one step, plus the walk-back that a mis-click needs. */
	const NEXT: Partial<Record<ProductionStatus, { to: ProductionStatus; label: string }[]>> = {
		draft: [
			{ to: 'offered', label: 'Send the offer' },
			{ to: 'confirmed', label: 'Confirm' }
		],
		offered: [
			{ to: 'confirmed', label: 'Confirm' },
			{ to: 'draft', label: 'Pull the offer' }
		],
		confirmed: [{ to: 'completed', label: 'Mark it played' }],
		completed: [],
		settled: [],
		closed: [],
		cancelled: []
	};

	const moves = $derived(NEXT[production.status] ?? []);
	const canCancel = $derived(['draft', 'offered', 'confirmed'].includes(production.status));
</script>

{#each moves as move (move.to)}
	<Action
		action={advanceProduction}
		label={move.label}
		successToast="Production {move.to}"
		variant="ghost"
		size="sm"
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', production.id)} />
			<input {...fields.eventId.as('hidden', eventId)} />
			<input {...fields.status.as('hidden', move.to)} />
			<p class="text-muted">Move this production to <strong>{move.to}</strong>?</p>
		{/snippet}
	</Action>
{/each}

{#if canCancel}
	<Action
		action={advanceProduction}
		label="Call it off"
		successToast="Production cancelled"
		variant="warning"
		size="sm"
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', production.id)} />
			<input {...fields.eventId.as('hidden', eventId)} />
			<input {...fields.status.as('hidden', 'cancelled')} />
			<p class="text-muted">
				Cancels the production record only. The listing on the guide is cancelled from the event
				page — that is what tells ticket holders.
			</p>
		{/snippet}
	</Action>
{/if}
