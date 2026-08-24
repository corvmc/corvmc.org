<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getStaffCategories, createArticle } from '$lib/remote/help.remote';
	const { fields } = createArticle;
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import MarkdownEditor from '$lib/components/help/MarkdownEditor.svelte';

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

<PageHeader title="New Article" subtitle="Help" backHref="/staff/help" />
<PageContent width="3xl">
	<Form
		remote={createArticle}
		guard
		onsuccess={(result) => goto(resolve(`/staff/help/${result?.id}`))}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<FormField name="title" label="Title">
					<input
						name="title"
						type="text"
						class="input w-full"
						placeholder="Article title"
						bind:value={titleValue}
					/>
				</FormField>
				<FormField name="slug" label="Slug">
					<input
						name="slug"
						type="text"
						class="input w-full"
						placeholder={autoSlug || 'auto-generated'}
					/>
				</FormField>
			</div>

			<div class="grid gap-4 sm:grid-cols-3">
				<FormField
					name="categoryId"
					type="select"
					label="Category"
					options={[
						{ value: '', label: 'Select category...' },
						...categories.map((c) => ({ value: c.id, label: c.name }))
					]}
				/>
				<FormField
					name="minRole"
					type="select"
					label="Minimum Role"
					value="member"
					options={[
						{ value: 'member', label: 'Member' },
						{ value: 'staff', label: 'Staff' },
						{ value: 'admin', label: 'Admin' }
					]}
				/>
				<FormField name="published" type="toggle" label="Status" checkboxLabel="Published" />
			</div>

			<FormField
				name="summary"
				type="text"
				label="Summary"
				placeholder="Brief description for listings"
			/>

			<FormField name="content" label="Content">
				<input {...fields.content.as('hidden', contentValue)} />
				<MarkdownEditor bind:value={contentValue} />
			</FormField>

			<div class="flex justify-end gap-2">
				<Button href="/staff/help" variant="ghost">Cancel</Button>
				<SubmitButton label="Create Article" />
			</div>
		</div>
	</Form>
</PageContent>
