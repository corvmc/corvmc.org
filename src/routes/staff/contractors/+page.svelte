<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { getContractorsPage, createContractorForm } from '#lib/remote/contractors.remote.js';
	import { contractorTradeLabels, contractorTrades, type ContractorTrade } from '#lib/config.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';

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

<PageHeader title={m.staff_contractors_contractors()} subtitle={m.staff_space()}>
	<Button
		href={withQuery(resolve('staff/volunteer/schedule'), 'kind=contractor')}
		variant="ghost"
		size="sm">{m.staff_jobs()}</Button
	>
	<Action
		action={createContractorForm}
		label={m.staff_contractors_new_contractor()}
		modalTitle={m.staff_contractors_new_contractor()}
		successToast={m.staff_contractors_success_toast()}
	>
		{#snippet form()}
			<Field field={fields.name} type="text" label={m.staff_name()} />
			<Field field={fields.trade} type="select" label={m.staff_trade()} options={tradeOptions} />
			<Field field={fields.contactName} type="text" label={m.staff_contact()} />
			<Field field={fields.phone} type="tel" label={m.staff_phone()} />
			<Field field={fields.email} type="email" label={m.staff_email()} />
			<Field field={fields.licenseNumber} type="text" label={m.staff_licence_number()} />
			<Field
				field={fields.insuranceExpiresAt}
				type="date"
				label={m.staff_insurance_expires()}
				description={m.staff_contractors_leave_blank_if_we_hold()}
			/>
			<Field field={fields.notes} type="textarea" label={m.staff_notes()} />
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if data.overdue.length > 0}
		<Alert type="warning">
			<ParaglideMessage
				message={m.staff_contractors_jobs_past_date_they_were}
				inputs={{
					staff_contractors_overdue: m.staff_contractors_overdue(),
					length: data.overdue.length,
					staff_contractors_open_queue: m.staff_contractors_open_queue()
				}}
				>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
					>{/snippet}{#snippet a({ children })}<a
						class="link"
						href={withQuery(resolve('staff/volunteer/schedule'), 'kind=contractor&contractor=late')}
						>{@render children?.()}</a
					>{/snippet}</ParaglideMessage
			>
		</Alert>
	{/if}

	{#if data.lapsing.length > 0}
		<Alert type="error">
			<span class="font-medium">{m.staff_insurance()}</span>
			{#each data.lapsing as c (c.id)}
				<div>
					<a class="link font-medium" href={resolve(`staff/contractors/${c.id}`)}>{c.name}</a>
					{#if c.insuranceExpiresAt}
						— {c.insuranceExpiresAt < new Date()
							? m.staff_contractors_expired_2()
							: m.staff_contractors_expires()}
						{formatDateShort(c.insuranceExpiresAt)}
					{/if}
				</div>
			{/each}
		</Alert>
	{/if}

	{#if data.contractors.length === 0}
		<EmptyState
			title={m.staff_contractors_no_contractors_yet()}
			description={m.staff_contractors_add_people_call_when_something()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_name()}</th>
				<th>{m.staff_trade()}</th>
				<th>{m.staff_contact()}</th>
				<th>{m.staff_insurance()}</th>
			{/snippet}
			{#each data.contractors as c (c.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`staff/contractors/${c.id}`)}>{c.name}</a>
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
							<span class="text-subtle">{m.staff_not_file()}</span>
						{:else if c.insuranceExpiresAt < new Date()}
							<Badge variant="error" size="sm">
								{m.staff_contractors_expired({
									formatDateShort: formatDateShort(c.insuranceExpiresAt)
								})}
							</Badge>
						{:else}
							{formatDateShort(c.insuranceExpiresAt)}
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={data.contractors.length} unit="contractors" />
	{/if}
</PageContent>
