<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getStaffCategories, createArticle } from '$lib/remote/help.remote';
	const { fields } = createArticle;
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import MarkdownEditor from '$lib/components/help/MarkdownEditor.svelte';
	import { helpAudiences, helpAudienceLabels } from '$lib/config';

	let categories = $derived(await getStaffCategories());

	let titleValue = $state('');
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

	let autoSlug = $derived(slugify(titleValue));
</script>

<PageHeader width="3xl" title={m.staff_new_article()} subtitle={m.staff_help()} />
<PageContent width="3xl">
	<Form
		remote={createArticle}
		guard
		onsuccess={(result) => goto(resolve(`/staff/help/${result?.id}`))}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<FormField name="title" label={m.staff_title()}>
					<input
						name="title"
						type="text"
						class="input w-full"
						placeholder={m.staff_help_create_article_title()}
						bind:value={titleValue}
					/>
				</FormField>
				<FormField name="slug" label={m.staff_slug()}>
					<input
						name="slug"
						type="text"
						class="input w-full"
						placeholder={autoSlug || m.staff_help_create_auto_generated()}
					/>
				</FormField>
			</div>

			<div class="grid gap-4 sm:grid-cols-4">
				<FormField
					name="categoryId"
					type="select"
					label={m.staff_category()}
					options={[
						{ value: '', label: m.staff_help_create_select_category() },
						...categories.map((c) => ({ value: c.id, label: c.name }))
					]}
				/>
				<FormField
					name="minRole"
					type="select"
					label={m.staff_audience()}
					value="member"
					options={helpAudiences.map((a) => ({ value: a, label: helpAudienceLabels[a] }))}
				/>
				<FormField
					name="published"
					type="toggle"
					label={m.staff_status()}
					checkboxLabel={m.staff_published()}
				/>
				<FormField name="sortOrder" type="number" label={m.staff_order_2()} value={0} min="0" />
			</div>

			<FormField
				name="summary"
				type="text"
				label={m.staff_summary()}
				placeholder={m.staff_help_create_brief_description_listings()}
			/>

			<FormField name="content" label={m.staff_content()}>
				<input {...fields.content.as('hidden', contentValue)} />
				<MarkdownEditor bind:value={contentValue} />
			</FormField>

			<div class="flex justify-end gap-2">
				<Button href="/staff/help" variant="ghost">{m.staff_cancel()}</Button>
				<SubmitButton label={m.staff_help_create_create_article()} />
			</div>
		</div>
	</Form>
</PageContent>
