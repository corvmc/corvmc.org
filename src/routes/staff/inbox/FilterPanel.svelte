<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
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
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import { contactSubjects, inboxViews } from '#lib/config.js';
	import { getInboxFilterCounts, getAssignableStaff } from '#lib/remote/inbox.remote.js';
	import type { InboxView } from '#lib/config.js';

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
		snoozed: 'Snoozed',
		resolved: 'Resolved',
		all: 'All'
	};

	const chip = (selected: boolean) =>
		`badge cursor-pointer gap-1.5 ${selected ? 'badge-primary' : 'badge-ghost'}`;
</script>

<div class="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-1">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-bold">{m.staff_inbox_filter_panel_filter_conversations_title()}</h2>
		<Button
			variant="ghost"
			size="sm"
			shape="square"
			onclick={onclose}
			aria-label={m.staff_inbox_filter_panel_close_filters_label()}
		>
			<IconX size={18} />
		</Button>
	</div>
	<p class="text-muted text-sm">{m.staff_inbox_filter_panel_list_updates_as_change_these_text()}</p>

	<div class="flex flex-col gap-2">
		<SectionLabel label={m.staff_status_label()} />
		<div class="flex flex-wrap gap-2">
			{#each inboxViews as key (key)}
				<button type="button" class={chip(view === key)} onclick={() => (view = key)}>
					{viewLabels[key]}
					<span class="opacity-70">{counts.status[key]}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<SectionLabel label={m.staff_inbox_filter_panel_inquiry_type_label()} />
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
					{key === 'other' ? m.staff_inbox_filter_panel_other_label() : key}
					<span class="opacity-70">{n}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<SectionLabel label={m.staff_assigned_2_label()} />
		<!-- Its own query. The staff list is not keyed by these filters and the
		     queue paints without it — same reason as AssignControl. -->
		<div class="flex flex-wrap items-center gap-2">
			<button type="button" class={chip(assigned === '')} onclick={() => (assigned = '')}>
				{m.staff_anyone_label()}
			</button>
			<button type="button" class={chip(assigned === 'mine')} onclick={() => (assigned = 'mine')}>
				{m.staff_inbox_filter_panel_me_label()}
			</button>
			<button
				type="button"
				class={chip(assigned === 'unassigned')}
				onclick={() => (assigned = 'unassigned')}
			>
				{m.staff_unassigned_label()}
			</button>
			{#await getAssignableStaff()}
				<span class="loading loading-xs loading-spinner"></span>
			{:then staffUsers}
				{#each staffUsers as s (s.id)}
					<button type="button" class={chip(assigned === s.id)} onclick={() => (assigned = s.id)}>
						{s.name}
					</button>
				{/each}
			{:catch}
				<!-- The chips above still filter. -->
			{/await}
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<SectionLabel label={m.staff_inbox_filter_panel_waiting_longer_than_label()} />
		<div class="flex items-center gap-3">
			<input
				type="range"
				class="range max-w-xs range-sm"
				min="0"
				max="14"
				step="1"
				aria-label={m.staff_inbox_filter_panel_waiting_longer_than_days_label()}
				bind:value={waitingDays}
			/>
			<span class="text-sm whitespace-nowrap">
				{waitingDays === 0
					? m.staff_inbox_filter_panel_any_text()
					: m.staff_inbox_filter_panel_days_text({ waitingDays })}
			</span>
		</div>
	</div>

	<div
		class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4"
	>
		<Badge
			>{m.staff_inbox_filter_panel_match_label({
				matching: counts.matching,
				total: counts.total
			})}</Badge
		>
		<div class="flex gap-2">
			<Button variant="ghost" size="sm" onclick={onreset}
				>{m.staff_inbox_filter_panel_reset_label()}</Button
			>
			<Button variant="default" size="sm" onclick={onsave}>{m.staff_save_as_view_label()}</Button>
			<Button variant="primary" size="sm" onclick={onclose}>{m.staff_done_label()}</Button>
		</div>
	</div>
</div>
