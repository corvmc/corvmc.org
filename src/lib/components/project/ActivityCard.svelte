<script lang="ts" module>
	import type { getProjectActivity } from '#lib/remote/projects.remote.js';

	export type ActivityPage = NonNullable<Awaited<ReturnType<typeof getProjectActivity>>>;
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { RemoteQuery } from '$app/server';
	import { resolve } from '$app/paths';
	import { ActivityFeedCard, type ActivityRow } from '#lib/components/ui/ActivityFeed/index.js';
	import { surfaces } from '#lib/config.js';

	/** A project's or a work order's history, beside the page's load-bearing query. */
	let {
		query,
		projectId
	}: {
		/** The activity read; `limit` is left off for the first page so writes can refresh it. */
		query: (limit?: number) => RemoteQuery<ActivityPage>;
		/** Links an entry about one task to its page. Omitted on that task's own page. */
		projectId?: string;
	} = $props();

	type Item = ActivityPage['items'][number];
	type Origin = NonNullable<Item['origin']>;
	// A ballot step stays in the history, unlinked while Ballots is off (#2116).
	const originHref = (o: Origin) =>
		o.kind === 'suggestion'
			? resolve('/staff/suggestions/[id]', { id: o.id })
			: surfaces.ballots
				? resolve('/staff/ballots/[id]', { id: o.id })
				: null;

	function toRow(item: Item): ActivityRow {
		return {
			id: item.id,
			at: item.at,
			actor: { name: item.actorName },
			summary: item.summary,
			href: item.origin ? originHref(item.origin) : null,
			context:
				item.task && projectId
					? {
							label: item.task.title,
							href: resolve('/staff/projects/[id]/tasks/[taskId]', {
								id: projectId,
								taskId: item.task.id
							})
						}
					: null
		};
	}
</script>

<ActivityFeedCard
	{query}
	{toRow}
	empty={{
		title: m.project_activity_card_title(),
		description: m.project_activity_card_description_body()
	}}
/>
