<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getStaffArticlePage, updateArticle, deleteArticle } from '$lib/remote/help.remote';
	const { fields: deleteFields } = deleteArticle;
	const { fields: updateFields } = updateArticle;
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import MarkdownEditor from '$lib/components/help/MarkdownEditor.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { IconTrash } from '@tabler/icons-svelte';
	import Alert from '$lib/components/ui/Alert.svelte';

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffArticlePage(id));
	const article = $derived(data.article);
	const categories = $derived(data.categories);

	let contentValue = $state('');

	$effect(() => {
		if (article) contentValue = article.content;
	});
</script>

<PageHeader title="Edit Article" subtitle="Help" backHref="/staff/help">
	<Action
		action={deleteArticle}
		modalTitle="Confirm"
		successToast="Article deleted"
		onsuccess={() => goto(resolve('/staff/help'))}
		variant="error"
		size="sm"
		outline
	>
		{#snippet form()}
			<input {...deleteFields.id.as('hidden', id)} />
			<p class="py-4">Permanently delete "{article?.title}"?</p>
		{/snippet}
		<IconTrash size={16} /> Delete
	</Action>
</PageHeader>
<PageContent width="3xl">
	{#if article}
		<Form remote={updateArticle} guard successToast="Article updated">
			<input {...updateFields.id.as('hidden', article.id)} />

			<div class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<FormField name="title" type="text" label="Title" value={article.title} />
					<FormField name="slug" type="text" label="Slug" value={article.slug} />
				</div>

				<div class="grid gap-4 sm:grid-cols-3">
					<FormField
						name="categoryId"
						type="select"
						label="Category"
						value={article.categoryId}
						options={categories.map((c) => ({ value: c.id, label: c.name }))}
					/>
					<FormField
						name="minRole"
						type="select"
						label="Minimum Role"
						value={article.minRole}
						options={[
							{ value: 'member', label: 'Member' },
							{ value: 'staff', label: 'Staff' },
							{ value: 'admin', label: 'Admin' }
						]}
					/>
					<FormField
						name="published"
						type="toggle"
						label="Status"
						value={article.published}
						checkboxLabel="Published"
					/>
				</div>

				<FormField
					name="summary"
					type="text"
					label="Summary"
					value={article.summary ?? ''}
					placeholder="Brief description"
				/>

				<FormField name="content" label="Content">
					<input {...updateFields.content.as('hidden', contentValue)} />
					<MarkdownEditor bind:value={contentValue} />
				</FormField>

				{#if article.source === 'static'}
					<Alert type="info" class="text-sm">
						This article is synced from a markdown file. Edits here will be overwritten on the next
						sync.
					</Alert>
				{/if}

				<div class="flex justify-end gap-2">
					<Button href="/staff/help" variant="ghost">Cancel</Button>
					<SubmitButton label="Save Changes" />
				</div>
			</div>
		</Form>
	{/if}
</PageContent>
