<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { relativeDay } from '$lib/utils/format';
	import type { NeedsYouItem } from '$lib/types/needs-you';

	/**
	 * What the member has to act on, soonest deadline first.
	 *
	 * Absent entirely when there is nothing — a dashboard that leads with an
	 * empty "Needs you" teaches the reader to skip the one region that matters
	 * on the day it is not empty.
	 */
	let { items }: { items: NeedsYouItem[] } = $props();

	const now = new Date();
	const overdue = (item: NeedsYouItem) => item.dueAt != null && item.dueAt < now;
	const count = $derived(items.length);
</script>

{#if count > 0}
	<InfoCard title="Needs you" state={count}>
		<ul class="flex flex-col divide-y divide-base-300">
			{#each items as item (item.kind + item.title)}
				<li class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
					<div class="min-w-0">
						<p class="font-medium">{item.title}</p>
						{#if item.detail}
							<p class="text-subtle text-sm">{item.detail}</p>
						{/if}
					</div>

					<div class="flex w-max items-center gap-3">
						{#if item.dueAt}
							<!-- The deadline is the reason the row is where it is, so it
							     reads beside the action rather than under the title. -->
							<span class="text-sm whitespace-nowrap" class:text-error={overdue(item)}>
								{relativeDay(item.dueAt)}
							</span>
						{/if}
						<Button
							href={item.href}
							variant={overdue(item) ? 'error' : 'default'}
							size="sm"
							class="latched"
						>
							{item.label}
						</Button>
					</div>
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}
