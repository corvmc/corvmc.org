<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import {
		getStaffHelpPage,
		createCategory,
		updateCategory,
		deleteCategory,
		setArticlesPublishedForm
	} from '$lib/remote/help.remote';
	const { fields: deleteFields } = deleteCategory;
	const { fields: createCatFields } = createCategory;
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Action from '$lib/components/ui/Action.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { IconPlus, IconTrash, IconPencil } from '@tabler/icons-svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { helpAudiences, helpAudienceLabels } from '$lib/config';

	const data = $derived(await getStaffHelpPage());
	const articles = $derived(data.articles);
	const categories = $derived(data.categories);

	let categoryMap = $derived(Object.fromEntries(categories.map((c) => [c.id, c.name])));

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
		// The wrapper this page reads, not the constituents it is assembled from.
		void getStaffHelpPage().refresh();
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

<PageHeader title={m.staff_help_title()}>
	<Button href="/staff/help/create" variant="default" size="sm">
		<IconPlus size={16} />
		{m.staff_new_article()}
	</Button>
</PageHeader>
<PageContent>
	<!-- Categories section -->
	<details class="collapse-arrow collapse mb-6 collapse-panel">
		<summary class="collapse-title text-sm font-medium"
			>{m.staff_help_manage_categories({ length: categories.length })}</summary
		>
		<div class="collapse-content">
			<div class="space-y-2">
				{#each categories as cat (cat.id)}
					{@const editCat = updateCategory.for(cat.id)}
					<div class="flex items-center justify-between gap-2 py-1">
						<div>
							<span class="text-sm font-medium">{cat.name}</span>
							<span class="ml-2 text-subtle">/{cat.slug}</span>
							<Badge variant="ghost" size="xs" class="ml-1">{cat.minRole}</Badge>
						</div>
						<div class="flex gap-1">
							<!-- `updateCategory` existed with no caller: a category created from
							     this page defaulted to minRole `member` with no icon and could
							     only be corrected in the database. -->
							<Action
								action={editCat}
								modalTitle={m.staff_help_edit_category()}
								successToast={m.staff_help_category_updated()}
								onsuccess={refreshData}
								variant="ghost"
								size="xs"
								iconOnly
								label={m.staff_edit()}
							>
								{#snippet form()}
									<input {...editCat.fields.id.as('hidden', cat.id)} />
									<div class="space-y-2">
										<FormField name="name" label={m.staff_name()}>
											<input
												{...editCat.fields.name.as('text', cat.name)}
												class="input w-full input-sm"
											/>
										</FormField>
										<FormField name="slug" label={m.staff_slug()}>
											<input
												{...editCat.fields.slug.as('text', cat.slug)}
												class="input w-full input-sm"
											/>
										</FormField>
										<FormField name="description" label={m.staff_description()}>
											<input
												{...editCat.fields.description.as('text', cat.description ?? '')}
												class="input w-full input-sm"
											/>
										</FormField>
										<FormField name="icon" label={m.staff_help_icon()}>
											<input
												{...editCat.fields.icon.as('text', cat.icon ?? '')}
												class="input w-full input-sm"
												placeholder={m.staff_help_tabler_book()}
											/>
										</FormField>
										<FormField name="minRole" label={m.staff_audience()}>
											<Select
												size="sm"
												class="w-full"
												{...editCat.fields.minRole.as('select', cat.minRole)}
											>
												{#each helpAudiences as audience (audience)}
													<option value={audience}>{helpAudienceLabels[audience]}</option>
												{/each}
											</Select>
										</FormField>
										<FormField name="sortOrder" label={m.staff_sort_order()}>
											<input
												{...editCat.fields.sortOrder.as('text', String(cat.sortOrder))}
												class="input w-full input-sm"
											/>
										</FormField>
									</div>
								{/snippet}
								<IconPencil size={14} />
							</Action>
							<Action
								action={deleteCategory}
								modalTitle={m.staff_confirm()}
								successToast={m.staff_category_deleted()}
								onsuccess={refreshData}
								variant="ghost"
								size="xs"
								iconOnly
								label={m.staff_delete()}
							>
								{#snippet form()}
									<input {...deleteFields.id.as('hidden', cat.id)} />
									<p class="py-4">{m.staff_help_delete_all_its_articles({ name: cat.name })}</p>
								{/snippet}
								<IconTrash size={14} />
							</Action>
						</div>
					</div>
				{/each}
			</div>
			<Form
				remote={createCategory}
				successToast={m.staff_help_category_created()}
				onsuccess={refreshData}
			>
				<div class="mt-4 flex flex-wrap items-end gap-2">
					<FormField name="name" label={m.staff_name()}>
						<input
							name="name"
							type="text"
							class="input w-40 input-sm"
							placeholder={m.staff_help_category_name()}
							bind:value={catNameValue}
						/>
					</FormField>
					<FormField name="slug" label={m.staff_slug()}>
						<input
							name="slug"
							type="text"
							class="input w-40 input-sm"
							placeholder={slugFromName(catNameValue) || m.staff_help_auto()}
						/>
					</FormField>
					<FormField name="description" label={m.staff_description()}>
						<!-- The binding, like the edit row and the hidden sortOrder beside it,
						     rather than the raw `name=` inputs this form otherwise uses. -->
						<input
							{...createCatFields.description.as('text', '')}
							class="input w-56 input-sm"
							placeholder={m.staff_help_what()}
						/>
					</FormField>
					<FormField name="icon" label={m.staff_help_icon()}>
						<input
							name="icon"
							type="text"
							class="input w-32 input-sm"
							placeholder={m.staff_help_tabler_book()}
						/>
					</FormField>
					<FormField name="minRole" label={m.staff_audience()}>
						<Select size="sm" class="w-32" name="minRole">
							{#each helpAudiences as audience (audience)}
								<option value={audience}>{helpAudienceLabels[audience]}</option>
							{/each}
						</Select>
					</FormField>
					<input {...createCatFields.sortOrder.as('hidden', String(categories.length))} />
					<SubmitButton label={m.staff_add()} variant="primary" size="sm" />
				</div>
			</Form>
		</div>
	</details>

	<!-- Articles table -->
	{#if articles.length === 0}
		<EmptyState message={m.staff_help_message()} />
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
				<Button variant="ghost" size="xs" onclick={selectDrafts}
					>{m.staff_help_select_all_drafts()}</Button
				>
			{/if}
			{#if selectedIds.length > 0}
				<Action
					action={setArticlesPublishedForm}
					label={m.staff_help_publish_selected()}
					modalTitle={m.staff_help_publish_articles()}
					successToast={m.staff_help_articles_published()}
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
					label={m.staff_help_unpublish_selected()}
					modalTitle={m.staff_help_unpublish_articles()}
					successToast={m.staff_help_articles_unpublished()}
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
						aria-label={m.staff_help_select_all_articles()}
						checked={allSelected}
						onchange={toggleAll}
					/>
				</th>
				<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
				<th>{m.staff_help_article()}</th>
				<th class="col-support w-px">{m.staff_source()}</th>
				<th class="col-extra w-px">{m.staff_role()}</th>
				<th class="col-support whitespace-nowrap">{m.staff_updated()}</th>
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
							aria-label={m.staff_help_select({ title: a.title })}
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
		<Pagination total={articles.length} unit="articles" />
	{/if}
</PageContent>
