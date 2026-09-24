<script lang="ts">
	/** The foundations, trusts and agencies the collective applies to. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FunderFields from './FunderFields.svelte';
	import {
		getFunders,
		createFunder,
		updateFunder,
		archiveFunder,
		restoreFunder,
		deleteFunder
	} from '$lib/remote/grants.remote';
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

<PageHeader title="Funders" subtitle="Grants" backHref="/staff/grants">
	<Action
		action={createFunder}
		label="New funder"
		modalTitle="New funder"
		submitLabel="Add funder"
		successToast="Funder added"
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
			Show archived
		</label>
	</div>

	{#if funders.length === 0}
		<EmptyState
			title="No funders yet"
			description="Add a foundation, trust or agency the collective applies to."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Funder</th>
				<th class="col-support">Contact</th>
				<th class="cell-num">Applications</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
			{/snippet}
			{#each funders as f (f.id)}
				{@const edit = updateFunder.for(f.id)}
				<tr class:opacity-60={f.deletedAt}>
					<td class="cell-primary font-medium">
						{f.name}
						{#if f.deletedAt}
							<Badge variant="ghost" size="sm" class="ml-2">Archived</Badge>
						{/if}
					</td>
					<td class="col-support">
						{[f.contactName, f.contactEmail].filter(Boolean).join(' · ') || '—'}
					</td>
					<td class="cell-num">{f.applications}</td>
					<td class="w-px whitespace-nowrap">
						<Action
							action={edit}
							label="Edit"
							variant="ghost"
							size="sm"
							modalTitle="Edit {f.name}"
							submitLabel="Save"
							successToast="Saved"
							onsuccess={refresh}
						>
							{#snippet form()}
								<input type="hidden" name="id" value={f.id} />
								<FunderFields fields={edit.fields} value={f} />
							{/snippet}
						</Action>
						{#if f.deletedAt}
							<Action
								action={restoreFunder.for(f.id)}
								label="Restore"
								variant="ghost"
								size="sm"
								successToast="Restored"
								onsuccess={refresh}
								noFooter
							>
								{#snippet form()}
									<input type="hidden" name="id" value={f.id} />
								{/snippet}
							</Action>
						{:else}
							<Action
								action={archiveFunder.for(f.id)}
								label="Archive"
								variant="ghost"
								size="sm"
								modalTitle="Archive {f.name}?"
								submitLabel="Archive"
								successToast="Archived"
								onsuccess={refresh}
							>
								{#snippet form()}
									<input type="hidden" name="id" value={f.id} />
									<p class="text-sm">
										It comes off this list and the picker for new applications. Its applications and
										reports stay, and it can be restored.
									</p>
								{/snippet}
							</Action>
						{/if}
						{#if f.applications === 0}
							<Action
								action={deleteFunder.for(f.id)}
								label="Delete"
								variant="ghost"
								size="sm"
								class="text-error"
								modalTitle="Delete {f.name}?"
								submitLabel="Delete"
								submitVariant="error"
								successToast="Deleted"
								onsuccess={refresh}
							>
								{#snippet form()}
									<input type="hidden" name="id" value={f.id} />
									<p class="text-sm">It has no applications, so nothing else changes.</p>
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
