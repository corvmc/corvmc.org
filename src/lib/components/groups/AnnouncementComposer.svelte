<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { createAnnouncement, updateAnnouncement } from '$lib/remote/announcements.remote';

	/**
	 * Write a post, or edit one.
	 *
	 * Mount-agnostic: it takes its group as a prop and knows nothing about either
	 * route, because the same component is the band panel's composer and the club
	 * page's. See docs/specs/groups-spec.md § One implementation, two mount points.
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
		label="Edit"
		iconOnly={false}
		modalTitle="Edit announcement"
		submitLabel="Save"
		successToast="Saved"
		variant="ghost"
		size="xs"
		onsuccess={() => invalidateAll()}
		onfailure={() => toast.error('Failed to save')}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...updateFields.groupId.as('hidden', groupId)} />
				<input {...updateFields.id.as('hidden', post.id)} />
				<FormField
					field={updateFields.title}
					type="text"
					label="Title"
					value={post.title}
					required
				/>
				<FormField
					field={updateFields.body}
					type="textarea"
					label="Body"
					value={post.body}
					description="Markdown. Links, lists and **bold** work."
					required
				/>
			</div>
		{/snippet}
	</Action>
{:else}
	<Action
		action={createAnnouncement}
		label="New announcement"
		modalTitle="New announcement"
		submitLabel="Save draft"
		successToast="Draft saved"
		variant="primary"
		size="sm"
		onsuccess={() => invalidateAll()}
		onfailure={() => toast.error('Failed to save')}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...createFields.groupId.as('hidden', groupId)} />
				<FormField
					field={createFields.title}
					type="text"
					label="Title"
					placeholder="August jam moved to the 27th"
					required
				/>
				<FormField
					field={createFields.body}
					type="textarea"
					label="Body"
					description="Markdown. Nobody is notified until you publish."
					required
				/>
			</div>
		{/snippet}
	</Action>
{/if}
