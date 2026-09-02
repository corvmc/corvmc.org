<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { getContractorsPage, createContractorForm } from '$lib/remote/contractors.remote';
	import { contractorTradeLabels, contractorTrades, type ContractorTrade } from '$lib/config';
	import { formatDateShort } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	/**
	 * Who we call, and the two things about them that need chasing.
	 *
	 * The warnings sit above the directory rather than as columns in it: a lapsed
	 * certificate and an overdue job are the only rows on this page anybody has to
	 * act on, and a table sorted by name buries both.
	 */
	const data = $derived(await getContractorsPage());
	const { fields } = createContractorForm;

	const tradeOptions = contractorTrades.map((t) => ({
		value: t,
		label: contractorTradeLabels[t]
	}));
</script>

<PageHeader title="Contractors" subtitle="Space">
	<Button href="/staff/contractors/jobs" variant="ghost" size="sm">Jobs</Button>
	<Action
		action={createContractorForm}
		label="New contractor"
		modalTitle="New contractor"
		successToast="Contractor added"
	>
		{#snippet form()}
			<Field field={fields.name} type="text" label="Name" />
			<Field field={fields.trade} type="select" label="Trade" options={tradeOptions} />
			<Field field={fields.contactName} type="text" label="Contact" />
			<Field field={fields.phone} type="tel" label="Phone" />
			<Field field={fields.email} type="email" label="Email" />
			<Field field={fields.licenseNumber} type="text" label="Licence number" />
			<Field
				field={fields.insuranceExpiresAt}
				type="date"
				label="Insurance expires"
				description="Leave blank if we hold no certificate — that is not the same as current, and the warnings above leave it out."
			/>
			<Field field={fields.notes} type="textarea" label="Notes" />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if data.overdue.length > 0}
		<Alert type="warning">
			<span class="font-medium">Overdue</span>
			{data.overdue.length}
			{data.overdue.length === 1 ? 'job is' : 'jobs are'} past the date they were promised back.
			<a class="link" href={resolve('/staff/contractors/jobs')}>Open the queue</a>
		</Alert>
	{/if}

	{#if data.lapsing.length > 0}
		<Alert type="error">
			<span class="font-medium">Insurance</span>
			{#each data.lapsing as c (c.id)}
				<div>
					<a class="link font-medium" href={resolve(`/staff/contractors/${c.id}`)}>{c.name}</a>
					{#if c.insuranceExpiresAt}
						— {c.insuranceExpiresAt < new Date() ? 'expired' : 'expires'}
						{formatDateShort(c.insuranceExpiresAt)}
					{/if}
				</div>
			{/each}
		</Alert>
	{/if}

	{#if data.contractors.length === 0}
		<EmptyState
			title="No contractors yet"
			description="Add the people you call when something needs a professional — an instrument tech, an electrician, the company that services the extinguishers."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Name</th>
				<th>Trade</th>
				<th>Contact</th>
				<th>Insurance</th>
			{/snippet}
			{#each data.contractors as c (c.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/contractors/${c.id}`)}>{c.name}</a>
						{#if c.contactName}
							<div class="text-subtle">{c.contactName}</div>
						{/if}
					</td>
					<td>
						<Badge variant="outline" size="sm">
							{contractorTradeLabels[c.trade as ContractorTrade]}
						</Badge>
					</td>
					<td>{c.phone ?? c.email ?? '—'}</td>
					<td>
						{#if !c.insuranceExpiresAt}
							<span class="text-subtle">Not on file</span>
						{:else if c.insuranceExpiresAt < new Date()}
							<Badge variant="error" size="sm">
								Expired {formatDateShort(c.insuranceExpiresAt)}
							</Badge>
						{:else}
							{formatDateShort(c.insuranceExpiresAt)}
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
