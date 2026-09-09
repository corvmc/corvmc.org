<!--
	What the bill still owes us, and the ask that starts the wait.

	Arrival is derived from the artifact itself, so nothing here is ticked off by
	hand and a rider filled in unprompted already reads as in. Asking the same act
	for the same thing again is a reminder, not a second row.
-->
<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { requestableArtifacts, requestableArtifactLabels } from '$lib/config';
	import { askForArtifact, dropArtifactRequest } from '$lib/remote/productions.remote';
	import type { OutstandingRequest } from '$lib/types/artifact-request';

	let {
		eventId,
		eventTitle,
		requests,
		acts,
		onchange
	}: {
		eventId: string;
		eventTitle: string;
		requests: OutstandingRequest[];
		acts: { entryId: string; name: string }[];
		onchange: () => void;
	} = $props();

	const outstanding = $derived(requests.filter((r) => !r.fulfilled));
	const overdue = $derived(outstanding.filter((r) => r.overdue).length);
</script>

<InfoCard title="Asked for">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<div class="flex items-center gap-1">
				{#if overdue > 0}
					<Badge color="error">{overdue} overdue</Badge>
				{:else if outstanding.length > 0}
					<Badge color="warning">{outstanding.length} outstanding</Badge>
				{/if}
				{#if acts.length > 0}
					<Action
						action={askForArtifact}
						label="Ask an act"
						variant="ghost"
						size="sm"
						modalTitle="Ask for something for {eventTitle}"
						submitLabel="Ask"
						successToast="Asked"
						onsuccess={onchange}
					>
						{#snippet form()}
							<input type="hidden" name="eventId" value={eventId} />
							<FormField
								name="entryId"
								label="Act"
								type="select"
								options={acts.map((a) => ({ value: a.entryId, label: a.name }))}
							/>
							<FormField
								name="artifact"
								label="What"
								type="select"
								options={requestableArtifacts.map((a) => ({
									value: a,
									label: requestableArtifactLabels[a]
								}))}
							/>
							<FormField
								name="dueDate"
								label="Due"
								type="date"
								description="Optional. A request with no date is open-ended and never reads as overdue."
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		</div>
	{/snippet}

	{#if requests.length === 0}
		<EmptyState
			title="Nothing asked for"
			description="Nobody has been asked for a rider, a press kit or poster art yet."
		/>
	{:else}
		<ul class="divide-y divide-base-300">
			{#each requests as req (req.id)}
				<li class="flex flex-wrap items-center gap-2 py-2">
					<span class="font-medium">{req.actName ?? 'Unknown act'}</span>
					<span class="text-sm">{requestableArtifactLabels[req.artifact]}</span>
					{#if req.fulfilled}
						<Badge color="success">In</Badge>
					{:else if req.overdue}
						<Badge color="error">Overdue</Badge>
					{:else}
						<Badge color="warning">Waiting</Badge>
					{/if}
					<span class="text-subtle text-sm whitespace-nowrap">
						{#if req.dueAt}
							due {formatDateShort(req.dueAt)}
						{:else}
							no deadline
						{/if}
					</span>
					<div class="ml-auto">
						<Action
							action={dropArtifactRequest}
							label="Cancel"
							variant="ghost"
							size="sm"
							modalTitle="Stop waiting on this?"
							submitLabel="Cancel request"
							successToast="Request cancelled"
							onsuccess={onchange}
						>
							{#snippet form()}
								<input type="hidden" name="id" value={req.id} />
								<input type="hidden" name="eventId" value={eventId} />
								<p class="text-sm">
									{requestableArtifactLabels[req.artifact]} from {req.actName ?? 'this act'} stops counting
									as outstanding. Asking again re-opens it.
								</p>
							{/snippet}
						</Action>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
