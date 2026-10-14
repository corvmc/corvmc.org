<script lang="ts" module>
	import type { getProjectActivity } from '$lib/remote/projects.remote';

	export type ActivityPage = NonNullable<Awaited<ReturnType<typeof getProjectActivity>>>;
</script>

<script lang="ts">
	import type { RemoteQuery } from '@sveltejs/kit';
	import { resolve } from '$app/paths';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatDateTimeShort } from '$lib/utils/format';

	/** One page of activity, newest first; "Show older" asks for a longer page. */
	let {
		query,
		limit,
		projectId,
		onmore
	}: {
		query: (limit?: number) => RemoteQuery<ActivityPage>;
		limit: number | undefined;
		projectId?: string;
		onmore: (limit: number) => void;
	} = $props();

	const PAGE = 25;
	const activity = $derived(await query(limit));

	type Origin = NonNullable<ActivityPage['items'][number]['origin']>;
	const originHref = (o: Origin) =>
		o.kind === 'suggestion'
			? resolve('/staff/suggestions/[id]', { id: o.id })
			: resolve('/staff/ballots/[id]', { id: o.id });
</script>

{#if activity.items.length === 0}
	<EmptyState
		title="Nothing recorded yet"
		description="Assignments, ticks, schedule changes and engagements show up here as they happen."
	/>
{:else}
	<ol class="flex flex-col divide-y divide-base-200" aria-label="Activity">
		{#each activity.items as item (item.id)}
			<li class="py-2 text-sm">
				<div>
					{#if item.origin}
						<a class="link" href={originHref(item.origin)}>{item.summary}</a>
					{:else}
						{item.summary}
					{/if}
				</div>
				<div class="text-muted text-xs">
					{item.actorName} · {formatDateTimeShort(item.at)}
					{#if item.task && projectId}
						·
						<a
							class="link"
							href={resolve('/staff/projects/[id]/tasks/[taskId]', {
								id: projectId,
								taskId: item.task.id
							})}>{item.task.title}</a
						>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
	{#if activity.hasMore}
		<Button size="sm" variant="ghost" onclick={() => onmore((limit ?? PAGE) + PAGE)}>
			Show older
		</Button>
	{/if}
{/if}
