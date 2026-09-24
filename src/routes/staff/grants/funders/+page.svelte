<script lang="ts">
	/** The foundations, trusts and agencies the collective applies to. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FunderFields from './FunderFields.svelte';
	import { getFunders, createFunder, updateFunder, deleteFunder } from '$lib/remote/grants.remote';

	const funders = $derived(await getFunders());

	async function refresh() {
		await getFunders().refresh();
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
				<tr>
					<td class="cell-primary font-medium">{f.name}</td>
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
