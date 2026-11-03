<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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

<PageHeader width="3xl" title={post.title} subtitle={m.staff_classifieds()}>
	{#if post.visibility !== 'visible'}
		<Action
			action={showForm}
			label={post.visibility === 'pending_review'
				? m.staff_classifieds_id_approve()
				: m.staff_restore()}
			modalTitle={m.staff_classifieds_id_put_post_board()}
			successToast={m.staff_classifieds_id_board()}
			size="sm"
			onsuccess={refresh}
		>
			{#snippet icon()}<IconEye size={16} />{/snippet}
			{#snippet form()}
				<input {...showForm.fields.postId.as('hidden', post.id)} />
				<input {...showForm.fields.visibility.as('hidden', 'visible')} />
				<p class="py-2">
					{m.staff_classifieds_id_members_will_see_straight_away()}
				</p>
			{/snippet}
		</Action>
	{/if}
	{#if post.visibility !== 'hidden'}
		<Action
			action={hideForm}
			label={m.staff_classifieds_id_hide()}
			modalTitle={m.staff_classifieds_id_take_post_down()}
			submitLabel={m.staff_classifieds_id_submit_label()}
			successToast={m.staff_hidden()}
			variant="ghost"
			size="sm"
			onsuccess={refresh}
		>
			{#snippet icon()}<IconEyeOff size={16} />{/snippet}
			{#snippet form()}
				<input {...hideForm.fields.postId.as('hidden', post.id)} />
				<input {...hideForm.fields.visibility.as('hidden', 'hidden')} />
				<p class="mb-3 text-muted">
					{m.staff_classifieds_id_nothing_deleted_author_sees_note()}
				</p>
				<FormField
					name="note"
					type="textarea"
					label={m.staff_classifieds_id_what_should_author_change()}
				/>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if post.visibilityNote}
		<Alert type="info"
			><p>{m.staff_classifieds_id_note_author({ visibilityNote: post.visibilityNote })}</p></Alert
		>
	{/if}
	<PostDetail {post} />
</PageContent>
