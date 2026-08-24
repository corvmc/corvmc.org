<script lang="ts">
	import {
		getStaffArticles,
		getStaffCategories,
		createCategory,
		updateCategory,
		deleteCategory,
		setArticlesPublishedForm
	} from '$lib/remote/help.remote';
	const { fields: deleteFields } = deleteCategory;
	const { fields: createCatFields } = createCategory;
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Action from '$lib/components/shared/Action.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { IconPlus, IconTrash, IconPencil } from '@tabler/icons-svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';

	let articles = $derived(await getStaffArticles());
	let categories = $derived(await getStaffCategories());

	let categoryMap = $derived(Object.fromEntries(categories.map((c) => [c.id, c.name])));

	// Mirrors ROLE_LEVEL in help-service — the tiers an article/category can require.
	const HELP_ROLES = ['member', 'sustaining', 'staff', 'admin'] as const;

	let catNameValue = $state('');

	// Bulk publish: `pnpm help:sync` imports every markdown article as a draft, so
	// without a multi-select the help centre stays empty until someone clicks
	// through ~60 articles one by one.
	let selectedIds = $state<string[]>([]);
	const drafts = $derived(articles.filter((a) => !a.published));
	const allSelected = $derived(articles.length > 0 && selectedIds.length === articles.length);

	function toggleArticle(id: string) {
		selectedIds = selectedIds.includes(id)
			? selectedIds.filter((s) => s !== id)
			: [...selectedIds, id];
	}

	function toggleAll() {
		selectedIds = allSelected ? [] : articles.map((a) => a.id);
	}

	function selectDrafts() {
		selectedIds = drafts.map((a) => a.id);
	}

	function slugFromName(name: string) {
		return name
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.trim();
	}

	function refreshData() {
		void getStaffArticles().refresh();
		void getStaffCategories().refresh();
	}

	// Two instances of the same form so the publish and unpublish modals keep
	// separate pending/result state.
	const bulkFields = setArticlesPublishedForm.fields;
	const unpublishSelected = setArticlesPublishedForm.for('unpublish');

	function afterBulk() {
		selectedIds = [];
		refreshData();
	}
</script>

<PageHeader title="Help Articles">
	<Button href="/staff/help/create" variant="default" size="sm">
		<IconPlus size={16} /> New Article
	</Button>
</PageHeader>
<PageContent>
	<!-- Categories section -->
	<details class="collapse collapse-arrow border border-base-300 bg-base-100 mb-6">
		<summary class="collapse-title font-medium text-sm"
			>Manage Categories ({categories.length})</summary
		>
		<div class="collapse-content">
			<div class="space-y-2">
				{#each categories as cat (cat.id)}
					{@const editCat = updateCategory.for(cat.id)}
					<div class="flex items-center justify-between gap-2 py-1">
						<div>
							<span class="font-medium text-sm">{cat.name}</span>
							<span class="text-xs opacity-50 ml-2">/{cat.slug}</span>
							<Badge variant="ghost" size="xs" class="ml-1">{cat.minRole}</Badge>
						</div>
						<div class="flex gap-1">
							<!-- `updateCategory` existed with no caller: a category created from
							     this page defaulted to minRole `member` with no icon and could
							     only be corrected in the database. -->
							<Action
								action={editCat}
								modalTitle="Edit category"
								successToast="Category updated"
								onsuccess={refreshData}
								variant="ghost"
								size="xs"
								iconOnly
								label="Edit"
							>
								{#snippet form()}
									<input {...editCat.fields.id.as('hidden', cat.id)} />
									<div class="space-y-2">
										<FormField name="name" label="Name">
											<input
												{...editCat.fields.name.as('text', cat.name)}
												class="input input-sm w-full"
											/>
										</FormField>
										<FormField name="slug" label="Slug">
											<input
												{...editCat.fields.slug.as('text', cat.slug)}
												class="input input-sm w-full"
											/>
										</FormField>
										<FormField name="description" label="Description">
											<input
												{...editCat.fields.description.as('text', cat.description ?? '')}
												class="input input-sm w-full"
											/>
										</FormField>
										<FormField name="icon" label="Icon">
											<input
												{...editCat.fields.icon.as('text', cat.icon ?? '')}
												class="input input-sm w-full"
												placeholder="tabler-book"
											/>
										</FormField>
										<FormField name="minRole" label="Minimum role">
											<Select
												size="sm"
												class="w-full"
												{...editCat.fields.minRole.as('select', cat.minRole)}
											>
												{#each HELP_ROLES as role (role)}
													<option value={role}>{role}</option>
												{/each}
											</Select>
										</FormField>
										<FormField name="sortOrder" label="Sort order">
											<input
												{...editCat.fields.sortOrder.as('text', String(cat.sortOrder))}
												class="input input-sm w-full"
											/>
										</FormField>
									</div>
								{/snippet}
								<IconPencil size={14} />
							</Action>
							<Action
								action={deleteCategory}
								modalTitle="Confirm"
								successToast="Category deleted"
								onsuccess={refreshData}
								variant="ghost"
								size="xs"
								iconOnly
								label="Delete"
							>
								{#snippet form()}
									<input {...deleteFields.id.as('hidden', cat.id)} />
									<p class="py-4">Delete "{cat.name}" and all its articles?</p>
								{/snippet}
								<IconTrash size={14} />
							</Action>
						</div>
					</div>
				{/each}
			</div>
			<Form remote={createCategory} successToast="Category created" onsuccess={refreshData}>
				<div class="flex gap-2 mt-4 items-end">
					<FormField name="name" label="Name">
						<input
							name="name"
							type="text"
							class="input input-sm w-40"
							placeholder="Category name"
							bind:value={catNameValue}
						/>
					</FormField>
					<FormField name="slug" label="Slug">
						<input
							name="slug"
							type="text"
							class="input input-sm w-40"
							placeholder={slugFromName(catNameValue) || 'auto'}
						/>
					</FormField>
					<FormField name="icon" label="Icon">
						<input name="icon" type="text" class="input input-sm w-32" placeholder="tabler-book" />
					</FormField>
					<FormField name="minRole" label="Role">
						<Select size="sm" class="w-32" name="minRole">
							{#each HELP_ROLES as role (role)}
								<option value={role}>{role}</option>
							{/each}
						</Select>
					</FormField>
					<input {...createCatFields.sortOrder.as('hidden', String(categories.length))} />
					<SubmitButton label="Add" variant="primary" size="sm" />
				</div>
			</Form>
		</div>
	</details>

	<!-- Articles table -->
	{#if articles.length === 0}
		<EmptyState message="No help articles yet. Create one to get started." />
	{:else}
		<!--
			Bulk publish bar. `pnpm help:sync` imports the markdown manual as drafts
			for review, so after a sync this is the difference between one action and
			~60 round trips through the editor.
		-->
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<span class="text-muted">
				{selectedIds.length} selected · {drafts.length} draft{drafts.length === 1 ? '' : 's'}
			</span>
			{#if drafts.length > 0}
				<Button variant="ghost" size="xs" onclick={selectDrafts}>Select all drafts</Button>
			{/if}
			{#if selectedIds.length > 0}
				<Action
					action={setArticlesPublishedForm}
					label="Publish selected"
					modalTitle="Publish articles"
					successToast="Articles published"
					onsuccess={afterBulk}
					variant="primary"
					size="xs"
				>
					{#snippet form()}
						{#each selectedIds as id, i (id)}
							<input {...bulkFields.ids[i].as('hidden', id)} />
						{/each}
						<input {...bulkFields.published.as('hidden', true)} />
						<p class="py-4">
							Publish {selectedIds.length} article{selectedIds.length === 1 ? '' : 's'} to the member
							help centre?
						</p>
					{/snippet}
				</Action>
				<Action
					action={unpublishSelected}
					label="Unpublish selected"
					modalTitle="Unpublish articles"
					successToast="Articles unpublished"
					onsuccess={afterBulk}
					variant="ghost"
					size="xs"
				>
					{#snippet form()}
						{#each selectedIds as id, i (id)}
							<input {...unpublishSelected.fields.ids[i].as('hidden', id)} />
						{/each}
						<input {...unpublishSelected.fields.published.as('hidden', false)} />
						<p class="py-4">
							Hide {selectedIds.length} article{selectedIds.length === 1 ? '' : 's'} from members?
						</p>
					{/snippet}
				</Action>
			{/if}
		</div>

		<Table>
			{#snippet head()}
				<th class="w-px">
					<input
						type="checkbox"
						class="checkbox checkbox-sm"
						aria-label="Select all articles"
						checked={allSelected}
						onchange={toggleAll}
					/>
				</th>
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Article</th>
				<th class="col-support w-px">Source</th>
				<th class="col-extra w-px">Role</th>
				<th class="col-support whitespace-nowrap">Updated</th>
			{/snippet}
			{#each articles as a (a.id)}
				{@const href = resolve(`/staff/help/${a.id}`)}
				<!-- `rowLink` ignores clicks inside inputs and labels, so the select
				     checkbox and the row-click affordance coexist. -->
				<tr class="hover cursor-pointer" use:rowLink={href}>
					<td class="w-px">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							aria-label="Select {a.title}"
							checked={selectedIds.includes(a.id)}
							onchange={() => toggleArticle(a.id)}
						/>
					</td>
					<td class="w-px"><StatusBadge status={a.published ? 'published' : 'draft'} /></td>
					<!-- Category was its own column; it qualifies the title, so it stays
					     the subline — supplied here because the category names are loaded
					     by a second query this page already makes. -->
					<td class="cell-primary">
						<EntityIdentity ref={a.ref}>
							{#snippet subtitle()}{categoryMap[a.categoryId] ?? '—'}{/snippet}
						</EntityIdentity>
					</td>
					<td class="col-support w-px">
						<Badge size="xs" variant={a.source === 'static' ? 'info' : 'ghost'}>{a.source}</Badge>
					</td>
					<td class="col-extra w-px"><span class="text-xs">{a.minRole}</span></td>
					<td class="col-support whitespace-nowrap">{formatDateShort(a.updatedAt)}</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
