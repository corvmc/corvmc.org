<script lang="ts">
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { contractorJobStatusBadge } from '$lib/config';
	import { engagementLabel, type Task } from './task-view';

	/** The one Assigned value: who does it, in whichever of the four modes it is in. */
	let { task, showNames = false }: { task: Task; showNames?: boolean } = $props();

	const MAX_FACES = 4;
	const faces = $derived(task.people.slice(0, MAX_FACES));
	const emptySlots = $derived(Math.max(0, Math.min(task.capacity, MAX_FACES) - faces.length));
	const filled = $derived(`${task.claimed}/${task.capacity}`);
</script>

{#if task.mode === 'contractor' && task.engagement}
	<span class="flex min-w-0 items-center gap-2">
		<span class="truncate">{task.engagement.contractorName}</span>
		<Badge variant={contractorJobStatusBadge[task.engagement.status]} size="sm">
			{engagementLabel(task.engagement)}
		</Badge>
	</span>
{:else if task.mode === 'members' || task.mode === 'open'}
	<span class="flex min-w-0 items-center gap-2">
		<span class="flex gap-0.5" aria-hidden="true">
			{#each faces as p (p.userId)}
				<Avatar
					class="size-6"
					size="avatar-sm"
					src={p.image ?? undefined}
					name={p.name}
					title={p.name}
				/>
			{/each}
			{#each { length: emptySlots } as _, i (i)}
				<span class="size-6 rounded-full border border-dashed border-base-content/30 bg-base-100"
				></span>
			{/each}
		</span>
		<span class="text-muted tabular-nums">{filled}</span>
		{#if task.mode === 'open'}
			<Badge variant="outline" size="sm">Open</Badge>
		{/if}
		{#if !showNames}
			<span class="sr-only">
				{task.people.length > 0 ? task.people.map((p) => p.name).join(', ') : 'Nobody yet'}
			</span>
		{/if}
	</span>
	{#if showNames && task.people.length > 0}
		<span class="mt-1 block text-muted">{task.people.map((p) => p.name).join(', ')}</span>
	{/if}
{:else}
	<span class="text-muted">Unassigned</span>
{/if}
