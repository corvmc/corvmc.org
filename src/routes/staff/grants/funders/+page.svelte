<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** The foundations, trusts and agencies the collective applies to. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FunderFields from './FunderFields.svelte';
	import {
		getFunders,
		createFunder,
		updateFunder,
		archiveFunder,
		restoreFunder,
		deleteFunder
	} from '#lib/remote/grants.remote.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const includeArchived = $derived(page.url.searchParams.get('archived') === '1');
	const funders = $derived(await getFunders({ includeArchived }));

	async function refresh() {
		await getFunders({ includeArchived }).refresh();
	}

	function setArchived(on: boolean) {
		const url = new URL(page.url);
		if (on) url.searchParams.set('archived', '1');
		else url.searchParams.delete('archived');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<PageHeader title={m.staff_funders()} subtitle={m.staff_grants()}>
	<Action
		action={createFunder}
		label={m.staff_grants_funders_new_funder()}
		modalTitle={m.staff_grants_funders_new_funder()}
		submitLabel={m.staff_grants_funders_add_funder()}
		successToast={m.staff_grants_funders_funder_added()}
		onsuccess={refresh}
	>
		{#snippet form()}
			<FunderFields fields={createFunder.fields} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	<div class="flex justify-end">
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={includeArchived}
				onchange={(e) => setArchived(e.currentTarget.checked)}
			/>
			{m.staff_show_archived()}
		</label>
	</div>

	{#if funders.length === 0}
		<EmptyState
			title={m.staff_no_funders_yet()}
			description={m.staff_grants_funders_description()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_funder()}</th>
				<th class="col-support">{m.staff_contact()}</th>
				<th class="cell-num">{m.staff_grants_funders_applications()}</th>
				<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
			{/snippet}
			{#each funders as f (f.id)}
				{@const edit = updateFunder.for(f.id)}
				<tr class:opacity-60={f.deletedAt}>
					<td class="cell-primary font-medium">
						{f.name}
						{#if f.deletedAt}
							<Badge variant="ghost" size="sm" class="ml-2">{m.staff_archived()}</Badge>
						{/if}
					</td>
					<td class="col-support">
						{[f.contactName, f.contactEmail].filter(Boolean).join(' · ') || '—'}
					</td>
					<td class="cell-num">{f.applications}</td>
					<td class="w-px whitespace-nowrap">
						<Action
							action={edit}
							label={m.staff_edit()}
							variant="ghost"
							size="sm"
							modalTitle={m.staff_edit_2({ name: f.name })}
							submitLabel={m.staff_save()}
							successToast={m.staff_saved()}
							onsuccess={refresh}
						>
							{#snippet form()}
								<input {...edit.fields.id.as('hidden', f.id)} />
								<FunderFields fields={edit.fields} value={f} />
							{/snippet}
						</Action>
						{#if f.deletedAt}
							<Action
								action={restoreFunder.for(f.id)}
								label={m.staff_restore()}
								variant="ghost"
								size="sm"
								successToast={m.staff_restored()}
								onsuccess={refresh}
								noFooter
							>
								{#snippet form()}
									<input {...restoreFunder.for(f.id).fields.id.as('hidden', f.id)} />
								{/snippet}
							</Action>
						{:else}
							<Action
								action={archiveFunder.for(f.id)}
								label={m.staff_archive()}
								variant="ghost"
								size="sm"
								modalTitle={m.staff_archive_2({ name: f.name })}
								submitLabel={m.staff_archive()}
								successToast={m.staff_archived()}
								onsuccess={refresh}
							>
								{#snippet form()}
									<input {...archiveFunder.for(f.id).fields.id.as('hidden', f.id)} />
									<p class="text-sm">
										{m.staff_grants_funders_comes_off_list_picker_new()}
									</p>
								{/snippet}
							</Action>
						{/if}
						{#if f.applications === 0}
							<Action
								action={deleteFunder.for(f.id)}
								label={m.staff_delete()}
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle={m.staff_delete_2({ name: f.name })}
								submitLabel={m.staff_delete()}
								submitVariant="error"
								successToast={m.staff_deleted()}
								onsuccess={refresh}
							>
								{#snippet form()}
									<input {...deleteFunder.for(f.id).fields.id.as('hidden', f.id)} />
									<p class="text-sm">{m.staff_grants_funders_has_no_applications_so_nothing()}</p>
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={funders.length} unit="funders" />
	{/if}
</PageContent>
