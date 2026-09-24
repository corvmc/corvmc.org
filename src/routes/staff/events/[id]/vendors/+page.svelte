<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { IconCheck, IconX, IconArrowBackUp, IconTable } from '@tabler/icons-svelte';
	import { formatDateTime, toLocalDateTime } from '$lib/utils/format';
	import { marketVendorStatuses, type MarketVendorStatus } from '$lib/config';
	import {
		decideVendorForm,
		getStaffMarketVendors,
		openMarketDayForm,
		setTableLabelForm,
		withdrawVendorForm
	} from '$lib/remote/market.remote';

	/**
	 * A market day's vendor applications. docs/specs/shipped/market-vendors-spec.md.
	 *
	 * Accept and decline each send the vendor a message on their inbox thread,
	 * which is why both modals ask for one: the decision and the telling are one
	 * act, and a decision nobody was told about is how a vendor turns up anyway.
	 */
	const setupFields = openMarketDayForm.fields;
	const decideFields = decideVendorForm.fields;
	const tableFields = setTableLabelForm.fields;
	const withdrawFields = withdrawVendorForm.fields;

	const eventId = $derived(page.params.id!);
	const data = $derived(await getStaffMarketVendors(eventId));

	type Tab = 'all' | MarketVendorStatus;
	let tab = $state<Tab>('applied');

	const counts = $derived(data.market?.counts);
	const tabs = $derived([
		...marketVendorStatuses.map((s) => ({
			key: s,
			label: s[0].toUpperCase() + s.slice(1),
			badge: counts?.[s] ?? 0
		})),
		{ key: 'all', label: 'All', badge: data.applications.length }
	]);
	const rows = $derived(
		tab === 'all' ? data.applications : data.applications.filter((a) => a.status === tab)
	);
	const tablesAssigned = $derived(
		data.applications
			.filter((a) => a.status === 'accepted')
			.reduce((n, a) => n + a.tablesRequested, 0)
	);

	const when = $derived(formatDateTime(data.event.startsAt));
	function acceptMessage(business: string, table?: string | null) {
		return `Hi ${business} — you're in for ${data.event.title} on ${when}.${
			table ? ` Your table is ${table}.` : ''
		} Reply here with any questions.`;
	}
	function declineMessage(business: string) {
		return `Hi ${business} — thank you for applying to ${data.event.title}. We can't offer you a table this time.`;
	}
</script>

<PageHeader title="Vendors: {data.event.title}" backHref="/staff/events/{data.event.id}">
	{#if data.market}
		<Action
			action={openMarketDayForm}
			label="Edit setup"
			modalTitle="Market setup"
			successToast="Saved"
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...setupFields.eventId.as('hidden', data.event.id)} />
				<FormField
					field={setupFields.applicationsCloseAt}
					type="datetime-local"
					label="Applications close"
					description="Leave blank to take applications until the market starts."
					value={data.market?.applicationsCloseAt
						? toLocalDateTime(data.market.applicationsCloseAt)
						: undefined}
				/>
				<FormField
					field={setupFields.tableCount}
					type="number"
					label="Tables available"
					value={data.market?.tableCount ?? undefined}
				/>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	{#if !data.market}
		<Card>
			<CardBody>
				<h2 class="font-semibold">Take vendor applications</h2>
				<p class="text-muted">
					Opening this listing as a market puts an "Apply for a table" button on its public page
					while applications are open. Each application arrives in the inbox as its own
					conversation.
				</p>
				<Form remote={openMarketDayForm} successToast="Open for applications" class="space-y-2">
					<input {...setupFields.eventId.as('hidden', data.event.id)} />
					<div class="grid gap-4 sm:grid-cols-2">
						<FormField
							field={setupFields.applicationsCloseAt}
							type="datetime-local"
							label="Applications close"
							description="Blank means open until the market starts."
						/>
						<FormField field={setupFields.tableCount} type="number" label="Tables available" />
					</div>
					<SubmitButton label="Open for applications" />
				</Form>
			</CardBody>
		</Card>
	{:else}
		<div class="flex flex-wrap gap-4">
			<StatCard title="To review" value={counts?.applied ?? 0} size="sm" class="p-4" />
			<StatCard title="Accepted" value={counts?.accepted ?? 0} size="sm" class="p-4" />
			<StatCard
				title="Tables taken"
				value={data.market.tableCount
					? `${tablesAssigned} / ${data.market.tableCount}`
					: tablesAssigned}
				size="sm"
				class="p-4"
			/>
			<StatCard
				title="Applications"
				value={data.market.accepting
					? data.market.applicationsCloseAt
						? `Open until ${formatDateTime(data.market.applicationsCloseAt)}`
						: 'Open'
					: 'Closed'}
				size="sm"
				class="p-4"
			/>
		</div>

		<TabBar {tabs} active={tab} onchange={(key) => (tab = key as Tab)} collapse />

		{#if rows.length === 0}
			<EmptyState
				title="No applications here"
				description={tab === 'applied'
					? 'Nothing waiting on a decision.'
					: 'Applications arrive from the public event page.'}
			/>
		{:else}
			<p class="text-muted text-sm">{rows.length} of {data.applications.length} applications</p>
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Vendor</th>
					<th class="col-support">Needs</th>
					<th class="col-support">Contact</th>
					<th>Table</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each rows as row (row.id)}
					<tr>
						<td><StatusBadge status={row.status} /></td>
						<td class="cell-primary">
							<div class="font-medium">{row.businessName}</div>
							<div class="line-clamp-1 text-muted text-sm">{row.offering}</div>
						</td>
						<td class="col-support">
							{row.tablesRequested}
							{row.tablesRequested === 1 ? 'table' : 'tables'}{row.needsPower ? ', power' : ''}
						</td>
						<td class="col-support">
							{#if row.threadId}
								<a class="link" href={resolve(`/staff/inbox/${row.threadId}`)}>
									{row.contactName ?? row.contactEmail}
								</a>
							{:else}
								<span class="text-muted">{row.contactName ?? '—'}</span>
							{/if}
						</td>
						<td>{row.tableLabel ?? '—'}</td>
						<td>
							<div class="flex w-max justify-end gap-1">
								{#if row.status !== 'accepted' && row.status !== 'withdrawn'}
									<Action
										action={decideVendorForm.for(`accept-${row.id}`)}
										label="Accept"
										iconOnly
										modalTitle="Accept {row.businessName}"
										successToast="Accepted — vendor told"
										variant="ghost"
										size="sm"
									>
										{#snippet icon()}<IconCheck size={16} />{/snippet}
										{#snippet form()}
											<input {...decideFields.vendorId.as('hidden', row.id)} />
											<input {...decideFields.decision.as('hidden', 'accepted')} />
											<FormField field={decideFields.tableLabel} label="Table" value="" />
											<FormField
												field={decideFields.message}
												type="textarea"
												label="Message to the vendor"
												description="Sent by email on their inbox thread."
												value={acceptMessage(row.businessName)}
											/>
										{/snippet}
									</Action>
								{/if}
								{#if row.status === 'accepted'}
									<Action
										action={setTableLabelForm.for(row.id)}
										label="Move table"
										iconOnly
										modalTitle="Table for {row.businessName}"
										successToast="Table saved"
										variant="ghost"
										size="sm"
									>
										{#snippet icon()}<IconTable size={16} />{/snippet}
										{#snippet form()}
											<input {...tableFields.vendorId.as('hidden', row.id)} />
											<FormField
												field={tableFields.tableLabel}
												label="Table"
												value={row.tableLabel ?? ''}
											/>
										{/snippet}
									</Action>
								{/if}
								{#if row.status === 'applied' || row.status === 'accepted'}
									<Action
										action={decideVendorForm.for(`decline-${row.id}`)}
										label="Decline"
										iconOnly
										modalTitle="Decline {row.businessName}"
										successToast="Declined — vendor told"
										variant="ghost"
										size="sm"
									>
										{#snippet icon()}<IconX size={16} />{/snippet}
										{#snippet form()}
											<input {...decideFields.vendorId.as('hidden', row.id)} />
											<input {...decideFields.decision.as('hidden', 'declined')} />
											<FormField
												field={decideFields.message}
												type="textarea"
												label="Message to the vendor"
												description="Sent by email on their inbox thread."
												value={declineMessage(row.businessName)}
											/>
										{/snippet}
									</Action>
								{/if}
								{#if row.status !== 'withdrawn'}
									<Action
										action={withdrawVendorForm.for(row.id)}
										label="Mark withdrawn"
										iconOnly
										modalTitle="{row.businessName} pulled out"
										successToast="Marked withdrawn"
										variant="ghost"
										size="sm"
									>
										{#snippet icon()}<IconArrowBackUp size={16} />{/snippet}
										{#snippet form()}
											<input {...withdrawFields.vendorId.as('hidden', row.id)} />
											<p>
												For when the vendor says they can't come. This is final, and frees their
												table. Nothing is sent to them.
											</p>
										{/snippet}
									</Action>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/if}
</PageContent>
