<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '$lib/components/ui/Action.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { invalidateAll } from '$app/navigation';
	import { formatDateShort } from '$lib/utils/format';
	import {
		deleteAnnouncement,
		pinAnnouncement,
		publishAnnouncement
	} from '$lib/remote/announcements.remote';
	import AnnouncementComposer from './AnnouncementComposer.svelte';
	import type { AnnouncementView } from '$lib/server/group/announcement-service';

	/**
	 * A group's announcements, wherever they are shown.
	 *
	 * Mount-agnostic by construction: it takes the posts and the group id as
	 * props and fetches nothing. That is what lets it be the band panel's page
	 * and the club page's tab at once, and it is also what keeps both surfaces
	 * inside their one load-bearing query — a component reaching for its own
	 * remote query is the fan-out `custom/no-concurrent-remote-queries` bans.
	 *
	 * `canManage` decides what controls render, and the server already decided
	 * what is *in* `announcements`: a plain member's list has no drafts in it to
	 * hide. The flag here is about affordances, never about concealment.
	 */
	let {
		groupId,
		announcements,
		canManage
	}: {
		groupId: string;
		announcements: AnnouncementView[];
		canManage: boolean;
	} = $props();

	const publishFields = publishAnnouncement.fields;
	const pinFields = pinAnnouncement.fields;
	const deleteFields = deleteAnnouncement.fields;
</script>

{#if canManage}
	<div class="flex justify-end">
		<AnnouncementComposer {groupId} />
	</div>
{/if}

{#if announcements.length === 0}
	<EmptyState
		description={canManage
			? m.groups_announcement_list_nothing_posted_yet_write_first()
			: m.groups_announcement_list_nothing_posted_yet()}
	/>
{:else}
	<div class="grid grid-cols-1 gap-3">
		{#each announcements as post (post.id)}
			{@const draft = !post.publishedAt}
			<Card tone={draft ? 'base-200' : undefined}>
				<CardBody class="gap-3">
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="grow text-base font-semibold">{post.title}</h3>
						{#if post.pinned}
							<Badge variant="primary">{m.groups_announcement_list_pinned()}</Badge>
						{/if}
						{#if draft}
							<!-- The one thing an author must not misread. A draft looks
							     exactly like a post until you notice nobody replied. -->
							<Badge variant="warning" data-testid="announcement-draft"
								>{m.groups_announcement_list_draft()}</Badge
							>
						{/if}
					</div>

					<!-- Sanitized server-side by `renderMarkdown`; the raw markdown is
					     `post.body`, which is what the editor reads back. -->
					<div class="prose prose-sm max-w-none">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (markdown render via renderMarkdown, asserted in announcement-service.spec.ts) -->
						{@html post.bodyHtml}
					</div>

					<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-subtle">
						{#if post.author}
							<EntityIdentity ref={post.author} size="sm" />
						{:else}
							<span>{m.groups_former_member()}</span>
						{/if}
						<span>
							{draft
								? `Saved ${formatDateShort(post.updatedAt)}`
								: `Posted ${formatDateShort(post.publishedAt!)}`}
						</span>
						{#if post.recipientCount !== null}
							<span
								>{m.groups_announcement_list_notified({
									recipientCount: post.recipientCount
								})}</span
							>
						{/if}
					</div>

					{#if canManage}
						<div class="flex flex-wrap items-center gap-2">
							{#if draft}
								<Action
									action={publishAnnouncement.for(post.id)}
									data-testid="publish-announcement"
									label={m.groups_announcement_list_publish()}
									modalTitle={m.groups_announcement_list_publish_announcement()}
									submitLabel={m.groups_announcement_list_publish()}
									confirm="Publish “{post.title}”? Everyone on the roster can read it from then on, and publishing cannot be undone."
									successToast={m.groups_announcement_list_published()}
									variant="primary"
									size="xs"
									onsuccess={() => invalidateAll()}
								>
									{#snippet form()}
										<input {...publishFields.groupId.as('hidden', groupId)} />
										<input {...publishFields.id.as('hidden', post.id)} />
									{/snippet}
								</Action>
							{/if}

							<AnnouncementComposer {groupId} {post} />

							<Action
								action={pinAnnouncement.for(post.id)}
								label={post.pinned
									? m.groups_announcement_list_unpin()
									: m.groups_announcement_list_pin()}
								successToast={post.pinned
									? m.groups_announcement_list_unpinned()
									: m.groups_announcement_list_pinned()}
								variant="ghost"
								size="xs"
								onsuccess={() => invalidateAll()}
							>
								{#snippet form()}
									<input {...pinFields.groupId.as('hidden', groupId)} />
									<input {...pinFields.id.as('hidden', post.id)} />
									<input {...pinFields.intent.as('hidden', post.pinned ? 'unpin' : 'pin')} />
								{/snippet}
							</Action>

							<Action
								action={deleteAnnouncement.for(post.id)}
								label={m.groups_delete()}
								modalTitle={m.groups_announcement_list_delete_announcement()}
								submitLabel={m.groups_delete()}
								confirm="Delete “{post.title}”? It comes off the list for everyone."
								successToast={m.groups_deleted()}
								variant="error"
								size="xs"
								outline
								onsuccess={() => invalidateAll()}
							>
								{#snippet form()}
									<input {...deleteFields.groupId.as('hidden', groupId)} />
									<input {...deleteFields.id.as('hidden', post.id)} />
								{/snippet}
							</Action>
						</div>
					{/if}
				</CardBody>
			</Card>
		{/each}
	</div>
{/if}
