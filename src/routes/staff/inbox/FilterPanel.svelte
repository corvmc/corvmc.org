<script lang="ts">
	/**
	 * The filters, in the main pane rather than a modal or a strip above the list.
	 *
	 * Three reasons it lives here: the list has to stay visible while you narrow
	 * it, the ~20rem list pane never fit search plus four controls, and every
	 * option carries the count it would leave — a number that only means anything
	 * beside the list it is promising.
	 *
	 * There is no Apply. The list re-filters as you change these, and `Done` only
	 * closes the panel. An Apply step is a second decision about a decision you
	 * have already made and can see the result of.
	 */
	import { IconX } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { contactSubjects, inboxViews } from '$lib/config';
	import { getInboxFilterCounts, getAssignableStaff } from '$lib/remote/inbox.remote';
	import type { InboxView } from '$lib/config';

	let {
		view = $bindable(),
		assigned = $bindable(),
		subject = $bindable(),
		waitingDays = $bindable(),
		filters,
		onreset,
		onsave,
		onclose
	}: {
		view: InboxView;
		assigned: string;
		subject: string;
		waitingDays: number;
		/** Exactly what the list is asking for, so the counts match what it shows. */
		filters: Record<string, unknown>;
		onreset: () => void;
		onsave: () => void;
		onclose: () => void;
	} = $props();

	// The panel's own query, keyed by the same filters as the list. Awaited here
	// rather than in the page so the queue paints without waiting on four counts.
	const counts = $derived(await getInboxFilterCounts(filters));

	const viewLabels: Record<InboxView, string> = {
		open: 'Open',
		awaiting: 'Awaiting reply',
		snoozed: 'Snoozed',
		resolved: 'Resolved',
		all: 'All'
	};

	const chip = (selected: boolean) =>
		`badge cursor-pointer gap-1.5 ${selected ? 'badge-primary' : 'badge-ghost'}`;
</script>

<div class="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-1">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold">Filter conversations</h2>
		<Button variant="ghost" size="sm" shape="square" onclick={onclose} aria-label="Close filters">
			<IconX size={18} />
		</Button>
	</div>
	<p class="text-muted text-sm">The list updates as you change these.</p>

	<div class="flex flex-col gap-2">
		<SectionLabel label="Status" />
		<div class="flex flex-wrap gap-2">
			{#each inboxViews as key (key)}
				<button type="button" class={chip(view === key)} onclick={() => (view = key)}>
					{viewLabels[key]}
					<span class="opacity-70">{counts.status[key === 'all' ? 'all' : key]}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<SectionLabel label="Inquiry type" />
		<div class="flex flex-wrap gap-2">
			<!-- Clicking the selected chip clears it: a facet with no "any" option
			     is a filter you can enter and not leave. -->
			{#each [...contactSubjects, 'other'] as key (key)}
				{@const n = counts.subject[key] ?? 0}
				<button
					type="button"
					class="{chip(subject === key)} {n === 0 && subject !== key ? 'opacity-40' : ''}"
					onclick={() => (subject = subject === key ? '' : key)}
				>
					{key === 'other' ? 'Other' : key}
					<span class="opacity-70">{n}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<SectionLabel label="Assigned to" />
		<!-- Its own query. The staff list is not keyed by these filters and the
		     queue paints without it — same reason as AssignControl. -->
		{#await getAssignableStaff()}
			<span class="loading loading-xs loading-spinner"></span>
		{:then staffUsers}
			<div class="flex flex-wrap gap-2">
				<button type="button" class={chip(assigned === '')} onclick={() => (assigned = '')}>
					Anyone
				</button>
				<button type="button" class={chip(assigned === 'mine')} onclick={() => (assigned = 'mine')}>
					Me
				</button>
				<button
					type="button"
					class={chip(assigned === 'unassigned')}
					onclick={() => (assigned = 'unassigned')}
				>
					Unassigned
				</button>
				{#each staffUsers as s (s.id)}
					<button type="button" class={chip(assigned === s.id)} onclick={() => (assigned = s.id)}>
						{s.name}
					</button>
				{/each}
			</div>
		{/await}
	</div>

	<div class="flex flex-col gap-2">
		<SectionLabel label="Waiting longer than" />
		<div class="flex items-center gap-3">
			<input
				type="range"
				class="range max-w-xs range-sm"
				min="0"
				max="14"
				step="1"
				aria-label="Waiting longer than, in days"
				bind:value={waitingDays}
			/>
			<span class="text-sm whitespace-nowrap">
				{waitingDays === 0 ? 'Any' : `${waitingDays} day${waitingDays === 1 ? '' : 's'}`}
			</span>
		</div>
	</div>

	<div
		class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4"
	>
		<Badge>{counts.matching} of {counts.total} match</Badge>
		<div class="flex gap-2">
			<Button variant="ghost" size="sm" onclick={onreset}>Reset</Button>
			<Button variant="default" size="sm" onclick={onsave}>Save as view</Button>
			<Button variant="primary" size="sm" onclick={onclose}>Done</Button>
		</div>
	</div>
</div>
