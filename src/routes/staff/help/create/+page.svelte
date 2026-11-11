<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getStaffCategories, createArticle } from '#lib/remote/help.remote.js';
	const { fields } = createArticle;
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import MarkdownEditor from '#lib/components/help/MarkdownEditor.svelte';
	import { helpAudiences, helpAudienceLabels } from '#lib/config.js';

	let categories = $derived(await getStaffCategories());

	let contentValue = $state('');

	// Mirrors `generateSlug` on the server: spaces and punctuation are dropped,
	// not hyphenated.
	function slugify(t: string) {
		return t
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '');
	}

	let autoSlug = $derived(slugify(createArticle.fields.title.value() ?? ''));
</script>

<PageHeader width="3xl" title={m.staff_new_article_title()} subtitle={m.staff_help_body()} />
<PageContent width="3xl">
	<Form
		remote={createArticle}
		guard
		onsuccess={(result) => goto(resolve(`staff/help/${result?.id}`))}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<FormField field={createArticle.fields.title} label={m.staff_title_label()}>
					<input
						{...createArticle.fields.title.as('text')}
						type="text"
						class="input w-full"
						placeholder={m.staff_help_create_article_title_placeholder()}
					/>
				</FormField>
				<FormField field={createArticle.fields.slug} label={m.staff_slug_label()}>
					<input
						{...createArticle.fields.slug.as('text')}
						type="text"
						class="input w-full"
						placeholder={autoSlug || m.staff_help_create_auto_generated_placeholder()}
					/>
				</FormField>
			</div>

			<div class="grid gap-4 sm:grid-cols-4">
				<FormField
					field={createArticle.fields.categoryId}
					type="select"
					label={m.staff_category_label()}
					options={[
						{ value: '', label: m.staff_help_create_select_category_label() },
						...categories.map((c) => ({ value: c.id, label: c.name }))
					]}
				/>
				<FormField
					field={createArticle.fields.minRole}
					type="select"
					label={m.staff_audience_label()}
					value="member"
					options={helpAudiences.map((a) => ({ value: a, label: helpAudienceLabels[a] }))}
				/>
				<FormField
					field={createArticle.fields.published}
					type="toggle"
					label={m.staff_status_label()}
					checkboxLabel={m.staff_published_checkbox()}
				/>
				<FormField
					field={createArticle.fields.sortOrder}
					submitAs="text"
					type="number"
					label={m.staff_order_2_label()}
					value={0}
					min="0"
				/>
			</div>

			<FormField
				field={createArticle.fields.summary}
				type="text"
				label={m.staff_summary_label()}
				placeholder={m.staff_help_create_brief_description_listings_placeholder()}
			/>

			<FormField field={createArticle.fields.content} label={m.staff_content_label()}>
				<input {...fields.content.as('hidden', contentValue)} />
				<MarkdownEditor bind:value={contentValue} />
			</FormField>

			<div class="flex justify-end gap-2">
				<Button href="/staff/help" variant="ghost">{m.staff_cancel_label()}</Button>
				<SubmitButton label={m.staff_help_create_create_article_label()} />
			</div>
		</div>
	</Form>
</PageContent>
