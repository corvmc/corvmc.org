<script lang="ts">
	import { IconUser } from '@tabler/icons-svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { contractorJobStatusBadge } from '$lib/config';
	import { engagementLabel, type Task } from './task-view';

	/**
	 * The one Assigned value: who does it, in whichever of the four modes it is in.
	 * People are a stack of one circle per wanted person (`capacity`): faces for
	 * who is on it, dashed slots for the rest, so its length is the count.
	 */
	let { task, showNames = false }: { task: Task; showNames?: boolean } = $props();

	const openSlots = $derived(Math.max(0, task.capacity - task.people.length));
	const lone = $derived(task.people.length === 1 ? task.people[0] : null);
	const spoken = $derived(
		`${task.people.length} of ${task.capacity}: ${
			task.people.length > 0 ? task.people.map((p) => p.name).join(', ') : 'nobody yet'
		}${task.mode === 'open' ? ', open to volunteers' : ''}${task.mode === 'unassigned' ? ', unassigned' : ''}`
	);
</script>

{#if task.mode === 'contractor' && task.engagement}
	<span class="flex min-w-0 items-center gap-2">
		<span class="truncate">{task.engagement.contractorName}</span>
		<Badge variant={contractorJobStatusBadge[task.engagement.status]} size="sm">
			{engagementLabel(task.engagement)}
		</Badge>
	</span>
{:else if task.people.length === 0 && task.capacity < 1}
	<span class="text-muted">Unassigned</span>
{:else}
	<span class="flex min-w-0 items-center gap-2">
		<span class="flex shrink-0 -space-x-1.5" aria-hidden="true" data-assigned-stack>
			{#each task.people as p (p.userId)}
				<span class="rounded-full ring-2 ring-base-100" data-slot="person">
					<Avatar
						class="size-6"
						size="avatar-sm"
						src={p.image ?? undefined}
						name={p.name}
						title={p.name}
					/>
				</span>
			{/each}
			{#each { length: openSlots } as _, i (i)}
				<span
					class="flex size-6 items-center justify-center rounded-full border border-dashed border-base-content/40 bg-base-100 text-subtle"
					data-slot="open"
				>
					<IconUser size={14} stroke={1.5} />
				</span>
			{/each}
		</span>
		{#if lone && !showNames}
			<span class="truncate" aria-hidden="true">{lone.name}</span>
		{/if}
		<span class="sr-only">{spoken}</span>
	</span>
	{#if showNames && task.people.length > 0}
		<span class="mt-1 block text-muted">{task.people.map((p) => p.name).join(', ')}</span>
	{/if}
{/if}
