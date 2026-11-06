<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getStaffArticlePage, updateArticle, deleteArticle } from '#lib/remote/help.remote.js';
	const { fields: deleteFields } = deleteArticle;
	const { fields: updateFields } = updateArticle;
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import MarkdownEditor from '#lib/components/help/MarkdownEditor.svelte';
	import { helpAudiences, helpAudienceLabels } from '#lib/config.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { IconTrash } from '@tabler/icons-svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');

	let id = $derived(params.id);
	const data = $derived(await getStaffArticlePage(id));
	const article = $derived(data.article);
	const categories = $derived(data.categories);

	let contentValue = $state('');

	$effect(() => {
		if (article) contentValue = article.content;
	});
</script>

<PageHeader width="3xl" title={m.staff_help_id_title()} subtitle={m.staff_help()}>
	<Action
		action={deleteArticle}
		modalTitle={m.staff_confirm()}
		successToast={m.staff_help_id_article_deleted()}
		onsuccess={() => goto(resolve('staff/help'))}
		variant="error"
		size="sm"
		outline
	>
		{#snippet form()}
			<input {...deleteFields.id.as('hidden', id)} />
			<p class="py-4">{m.staff_help_id_permanently_delete({ value: article?.title })}</p>
		{/snippet}
		<IconTrash size={16} />
		{m.staff_delete()}
	</Action>
</PageHeader>
<PageContent width="3xl">
	{#if article}
		<Form remote={updateArticle} guard successToast={m.staff_help_id_article_updated()}>
			<input {...updateFields.id.as('hidden', article.id)} />

			<div class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<FormField
						field={updateArticle.fields.title}
						type="text"
						label={m.staff_title()}
						value={article.title}
					/>
					<FormField
						field={updateArticle.fields.slug}
						type="text"
						label={m.staff_slug()}
						value={article.slug}
					/>
				</div>

				<div class="grid gap-4 sm:grid-cols-4">
					<FormField
						field={updateArticle.fields.categoryId}
						type="select"
						label={m.staff_category()}
						value={article.categoryId}
						options={categories.map((c) => ({ value: c.id, label: c.name }))}
					/>
					<FormField
						field={updateArticle.fields.minRole}
						type="select"
						label={m.staff_audience()}
						value={article.minRole}
						options={helpAudiences.map((a) => ({ value: a, label: helpAudienceLabels[a] }))}
					/>
					<FormField
						field={updateArticle.fields.published}
						type="toggle"
						label={m.staff_status()}
						value={article.published}
						checkboxLabel={m.staff_published()}
					/>
					<FormField
						field={updateArticle.fields.sortOrder}
						submitAs="text"
						type="number"
						label={m.staff_order_2()}
						value={article.sortOrder}
						min="0"
					/>
				</div>

				<FormField
					field={updateArticle.fields.summary}
					type="text"
					label={m.staff_summary()}
					value={article.summary ?? ''}
					placeholder={m.staff_help_id_placeholder()}
				/>

				<FormField field={updateArticle.fields.content} label={m.staff_content()}>
					<input {...updateFields.content.as('hidden', contentValue)} />
					<MarkdownEditor bind:value={contentValue} />
				</FormField>

				{#if article.source === 'static'}
					<Alert type="info" class="text-sm">
						{m.staff_help_id_article_synced_from_markdown_file()}
					</Alert>
				{/if}

				<div class="flex justify-end gap-2">
					<Button href="/staff/help" variant="ghost">{m.staff_cancel()}</Button>
					<SubmitButton label={m.staff_help_id_save_changes()} />
				</div>
			</div>
		</Form>
	{/if}
</PageContent>
