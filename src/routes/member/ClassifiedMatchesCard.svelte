<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import BadgeList from '#lib/components/ui/BadgeList.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { classifiedKindLabel, classifiedCategoryLabels } from '#lib/config.js';
	import type { getMemberDashboard } from '#lib/remote/users.remote.js';

	/**
	 * Classified posts that share a tag with this member's profile (#2549). Off
	 * the page when there are none: the board is one click away in the sidebar.
	 */
	let { posts }: { posts: Awaited<ReturnType<typeof getMemberDashboard>>['classifiedMatches'] } =
		$props();
</script>

{#if posts.length > 0}
	<InfoCard title={m.member_classified_matches_title()}>
		{#snippet action()}
			<a href={resolve('/member/classifieds')} class="link text-sm link-primary"
				>{m.member_classified_matches_view_all_label()}</a
			>
		{/snippet}
		<ul class="space-y-2">
			{#each posts as post (post.id)}
				<li class="flex flex-wrap items-center justify-between gap-2 inset px-3 py-2">
					<a href={resolve('/member/classifieds/[id]', { id: post.id })} class="min-w-0">
						<EntityIdentity ref={post.ref}>
							{#snippet subtitle()}
								{classifiedKindLabel(post.kind, post.category)} · {classifiedCategoryLabels[
									post.category
								]}
							{/snippet}
						</EntityIdentity>
					</a>
					<!-- The overlap that put the post here, not its whole tag list. -->
					<BadgeList items={post.sharedTags} max={3} />
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}
