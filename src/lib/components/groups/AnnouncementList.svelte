<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import { refreshAll } from '$app/navigation';
	import { formatDateShort } from '#lib/utils/format.js';
	import {
		deleteAnnouncement,
		pinAnnouncement,
		publishAnnouncement
	} from '#lib/remote/announcements.remote.js';
	import AnnouncementComposer from './AnnouncementComposer.svelte';
	import type { AnnouncementView } from '#lib/server/group/announcement-service.js';

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
			? m.groups_announcement_list_nothing_posted_yet_write_first_body()
			: m.groups_announcement_list_nothing_posted_yet_body()}
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
							<Badge variant="primary">{m.groups_announcement_list_pinned_label()}</Badge>
						{/if}
						{#if draft}
							<!-- The one thing an author must not misread. A draft looks
							     exactly like a post until you notice nobody replied. -->
							<Badge variant="warning" data-testid="announcement-draft"
								>{m.groups_announcement_list_draft_label()}</Badge
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
							<span>{m.groups_former_member_text()}</span>
						{/if}
						<span>
							{draft
								? m.groups_announcement_list_saved_text({
										formatDateShort: formatDateShort(post.updatedAt)
									})
								: m.groups_announcement_list_posted_text({
										formatDateShort: formatDateShort(post.publishedAt!)
									})}
						</span>
						{#if post.recipientCount !== null}
							<span
								>{m.groups_announcement_list_notified_text({
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
									label={m.groups_announcement_list_publish_label()}
									modalTitle={m.groups_announcement_list_publish_announcement_title()}
									submitLabel={m.groups_announcement_list_publish_label()}
									confirm={m.groups_announcement_list_publish_everyone_roster_can_read_body({
										title: post.title
									})}
									successToast={m.groups_announcement_list_published_toast()}
									variant="primary"
									size="xs"
									onsuccess={() => refreshAll()}
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
									? m.groups_announcement_list_unpin_label()
									: m.groups_announcement_list_pin_label()}
								successToast={post.pinned
									? m.groups_announcement_list_unpinned_toast()
									: m.groups_announcement_list_pinned_toast()}
								variant="ghost"
								size="xs"
								onsuccess={() => refreshAll()}
							>
								{#snippet form()}
									<input {...pinFields.groupId.as('hidden', groupId)} />
									<input {...pinFields.id.as('hidden', post.id)} />
									<input {...pinFields.intent.as('hidden', post.pinned ? 'unpin' : 'pin')} />
								{/snippet}
							</Action>

							<Action
								action={deleteAnnouncement.for(post.id)}
								label={m.groups_delete_label()}
								modalTitle={m.groups_announcement_list_delete_announcement_title()}
								submitLabel={m.groups_delete_label()}
								confirm={m.groups_announcement_list_delete_comes_off_list_everyone_body({
									title: post.title
								})}
								successToast={m.groups_deleted_toast()}
								variant="error"
								size="xs"
								outline
								onsuccess={() => refreshAll()}
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
