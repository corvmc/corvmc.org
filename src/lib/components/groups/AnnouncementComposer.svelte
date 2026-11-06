<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { refreshAll } from '$app/navigation';
	import { createAnnouncement, updateAnnouncement } from '#lib/remote/announcements.remote.js';

	/**
	 * Write a post, or edit one.
	 *
	 * Mount-agnostic: it takes its group as a prop and knows nothing about either
	 * route, because the same component is the band panel's composer and the club
	 * page's. See docs/specs/shipped/groups-spec.md § One implementation, two mount points.
	 *
	 * Writing is not publishing. What this saves is a draft — the roster hears
	 * nothing until somebody presses Publish — which is why the submit button
	 * says Save rather than Post.
	 */
	let {
		groupId,
		post = null
	}: {
		groupId: string;
		/** Present when editing. Absent when composing something new. */
		post?: { id: string; title: string; body: string } | null;
	} = $props();

	const createFields = createAnnouncement.fields;
	const updateFields = updateAnnouncement.fields;

	const editing = $derived(!!post);
</script>

{#if editing && post}
	<Action
		action={updateAnnouncement.for(post.id)}
		label={m.groups_edit()}
		iconOnly={false}
		modalTitle={m.groups_announcement_composer_edit_announcement()}
		submitLabel={m.groups_save()}
		successToast={m.groups_saved()}
		variant="ghost"
		size="xs"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...updateFields.groupId.as('hidden', groupId)} />
				<input {...updateFields.id.as('hidden', post.id)} />
				<FormField
					field={updateFields.title}
					type="text"
					label={m.groups_announcement_composer_title()}
					value={post.title}
					required
				/>
				<FormField
					field={updateFields.body}
					type="textarea"
					label={m.groups_announcement_composer_body()}
					value={post.body}
					description={m.groups_announcement_composer_markdown_links_lists_bold_work()}
					required
				/>
			</div>
		{/snippet}
	</Action>
{:else}
	<Action
		action={createAnnouncement}
		data-testid="new-announcement"
		label={m.groups_announcement_composer_new_announcement()}
		modalTitle={m.groups_announcement_composer_new_announcement()}
		submitLabel={m.groups_announcement_composer_save_draft()}
		successToast={m.groups_announcement_composer_draft_saved()}
		variant="primary"
		size="sm"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...createFields.groupId.as('hidden', groupId)} />
				<FormField
					field={createFields.title}
					type="text"
					label={m.groups_announcement_composer_title()}
					placeholder={m.groups_announcement_composer_placeholder()}
					required
				/>
				<FormField
					field={createFields.body}
					type="textarea"
					label={m.groups_announcement_composer_body()}
					description={m.groups_announcement_composer_markdown_nobody_notified_until()}
					required
				/>
			</div>
		{/snippet}
	</Action>
{/if}
