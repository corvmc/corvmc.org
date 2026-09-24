<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import PostDetail from '$lib/components/classified/PostDetail.svelte';
	import { IconEye, IconEyeOff } from '@tabler/icons-svelte';
	import { getStaffClassifiedDetail, moderateClassified } from '$lib/remote/classifieds.remote';

	const id = $derived(page.params.id!);
	const post = $derived(await getStaffClassifiedDetail(id));

	const showForm = $derived(moderateClassified.for(`${id}:show`));
	const hideForm = $derived(moderateClassified.for(`${id}:hide`));

	function refresh() {
		void getStaffClassifiedDetail(id).refresh();
	}
</script>

<PageHeader width="3xl" title={post.title} subtitle="Classifieds" backHref="/staff/classifieds">
	{#if post.visibility !== 'visible'}
		<Action
			action={showForm}
			label={post.visibility === 'pending_review' ? 'Approve' : 'Restore'}
			modalTitle="Put this post on the board?"
			successToast="On the board"
			size="sm"
			onsuccess={refresh}
		>
			{#snippet icon()}<IconEye size={16} />{/snippet}
			{#snippet form()}
				<input {...showForm.fields.postId.as('hidden', post.id)} />
				<input {...showForm.fields.visibility.as('hidden', 'visible')} />
				<p class="py-2">
					Members will see it straight away, until it expires or its author closes it.
				</p>
			{/snippet}
		</Action>
	{/if}
	{#if post.visibility !== 'hidden'}
		<Action
			action={hideForm}
			label="Hide"
			modalTitle="Take this post down"
			submitLabel="Hide it"
			successToast="Hidden"
			variant="ghost"
			size="sm"
			onsuccess={refresh}
		>
			{#snippet icon()}<IconEyeOff size={16} />{/snippet}
			{#snippet form()}
				<input {...hideForm.fields.postId.as('hidden', post.id)} />
				<input {...hideForm.fields.visibility.as('hidden', 'hidden')} />
				<p class="mb-3 text-muted">
					Nothing is deleted. The author sees your note, can edit the post, and it comes back to you
					for review.
				</p>
				<FormField name="note" type="textarea" label="What should the author change?" />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if post.visibilityNote}
		<Alert type="info"><p>Note to the author: {post.visibilityNote}</p></Alert>
	{/if}
	<PostDetail {post} />
</PageContent>
