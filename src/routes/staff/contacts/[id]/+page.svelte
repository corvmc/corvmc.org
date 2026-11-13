<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** One outside organization: its roles, its people and what names it (#2622). */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import OrganizationFields from '../OrganizationFields.svelte';
	import PersonFields from './PersonFields.svelte';
	import {
		addOrganizationRole,
		addPerson,
		archiveOrganization,
		getOrganizationPage,
		removeOrganizationRole,
		removePerson,
		saveVendorDetail,
		updateOrganization,
		updatePerson
	} from '#lib/remote/contacts.remote.js';
	import {
		contractorTradeLabels,
		grantStatusLabels,
		partyRoleLabels,
		partyRoles,
		sponsorshipStatusLabels,
		contractorJobStatusLabels,
		orderStatusLabels,
		marketVendorStatusLabels,
		MARKET_MAX_TABLES_REQUESTED
	} from '#lib/config.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { routeParams } from '#lib/route-params.svelte.js';
	import RelatedTasks from '#lib/components/task/RelatedTasks.svelte';
	import PartyTimeline from '../PartyTimeline.svelte';
	import RelatedShifts from '#lib/components/volunteer/RelatedShifts.svelte';

	const params = routeParams('id');
	const id = $derived(params.id);
	const org = $derived(await getOrganizationPage(id));
	const editForm = $derived(updateOrganization.for(id));
	const archiveForm = $derived(archiveOrganization.for(id));

	const addableRoles = $derived(
		partyRoles
			.filter((r) => r !== 'contractor' && !org.roles.includes(r))
			.map((r) => ({ value: r, label: partyRoleLabels[r] }))
	);
</script>

<PageHeader title={org.name} subtitle={m.staff_contacts_organization_body()}>
	{#if org.canManage}
		<Action
			action={archiveForm}
			label={org.archivedAt ? m.staff_restore_label() : m.staff_archive_label()}
			variant="ghost"
			size="sm"
			modalTitle={org.archivedAt
				? m.staff_contacts_restore_title()
				: m.staff_contacts_archive_title()}
			confirm={org.archivedAt ? undefined : m.staff_contacts_archived_body()}
			successToast={org.archivedAt ? m.staff_restored_toast() : m.staff_archived_toast()}
		>
			{#snippet form()}
				<input {...archiveForm.fields.id.as('hidden', org.id)} />
				<input {...archiveForm.fields.archived.as('hidden', !org.archivedAt)} />
			{/snippet}
		</Action>
		<Action
			action={editForm}
			label={m.staff_edit_label()}
			variant="ghost"
			size="sm"
			modalTitle={m.staff_edit_2_title({ name: org.name })}
			submitLabel={m.staff_save_label()}
			successToast={m.staff_saved_toast()}
		>
			{#snippet form()}
				<input {...editForm.fields.id.as('hidden', org.id)} />
				<OrganizationFields fields={editForm.fields} value={org} />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	{#if org.archivedAt}
		<Alert type="warning">{m.staff_contacts_archived_body()}</Alert>
	{/if}

	<InfoCard title={m.staff_contacts_details_title()}>
		<DefinitionList>
			<Fact label={m.staff_website_label()} value={org.website ?? '—'} />
			{#if org.contractor}
				<Fact label={m.staff_trade_label()} value={contractorTradeLabels[org.contractor.trade]} />
				<Fact label={m.staff_licence_number_label()} value={org.contractor.licenseNumber ?? '—'} />
			{/if}
			{#if org.notes}
				<Fact label={m.staff_notes_label()} wrap>{org.notes}</Fact>
			{/if}
		</DefinitionList>
	</InfoCard>

	<InfoCard title={m.staff_contacts_roles_title()}>
		{#snippet action()}
			{#if org.canManage && addableRoles.length > 0}
				{@const roleForm = addOrganizationRole.for(org.id)}
				<Action
					action={roleForm}
					label={m.staff_contacts_add_role_label()}
					variant="ghost"
					size="sm"
					modalTitle={m.staff_contacts_add_role_title()}
					successToast={m.staff_contacts_role_added_toast()}
				>
					{#snippet form()}
						<input {...roleForm.fields.id.as('hidden', org.id)} />
						<Field
							field={roleForm.fields.role}
							type="select"
							label={m.staff_role_label()}
							options={addableRoles}
						/>
					{/snippet}
				</Action>
			{/if}
		{/snippet}
		<div class="flex flex-wrap items-center gap-2">
			{#each org.roles as role (role)}
				{@const dropForm = removeOrganizationRole.for(`${org.id}:${role}`)}
				<span class="flex items-center gap-1">
					<Badge variant="outline">{partyRoleLabels[role]}</Badge>
					{#if org.canManage}
						<Action
							action={dropForm}
							label={m.staff_remove_label()}
							variant="ghost"
							size="xs"
							modalTitle={m.staff_contacts_remove_role_title()}
							submitVariant="error"
							successToast={m.staff_removed_toast()}
							onsuccess={(r) => {
								if ((r as { deleted?: boolean } | undefined)?.deleted)
									goto(resolve('staff/contacts'));
							}}
						>
							{#snippet form()}
								<input {...dropForm.fields.id.as('hidden', org.id)} />
								<input {...dropForm.fields.role.as('hidden', role)} />
							{/snippet}
						</Action>
					{/if}
				</span>
			{/each}
		</div>
		{#if org.roles.includes('contractor')}
			<a class="link text-sm" href={resolve(`staff/contractors/${org.id}`)}>
				{m.staff_contacts_open_contractor_label()}
			</a>
		{/if}
		{#if org.roles.includes('sponsor')}
			<a class="link text-sm" href={resolve(`staff/sponsors/${org.id}`)}>
				{m.staff_contacts_open_sponsor_label()}
			</a>
		{/if}
	</InfoCard>

	<InfoCard title={m.staff_contacts_people_title()}>
		{#snippet action()}
			{#if org.canManage}
				<Action
					action={addPerson}
					label={m.staff_contacts_add_person_label()}
					variant="ghost"
					size="sm"
					modalTitle={m.staff_contacts_add_person_title()}
					successToast={m.staff_contacts_person_added_toast()}
				>
					{#snippet form()}
						<input {...addPerson.fields.organizationId.as('hidden', org.id)} />
						<PersonFields fields={addPerson.fields} />
					{/snippet}
				</Action>
			{/if}
		{/snippet}
		{#if org.people === null}
			<p class="text-muted">{m.staff_contacts_people_hidden_body()}</p>
		{:else if org.people.length === 0}
			<EmptyState title={m.staff_contacts_no_people_title()} />
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_name_label()}</th>
					<th>{m.staff_email_label()}</th>
					<th class="col-support">{m.staff_phone_label()}</th>
					{#if org.canManage}
						<th class="w-px"><span class="sr-only">{m.staff_edit_label()}</span></th>
					{/if}
				{/snippet}
				{#each org.people as person (person.id)}
					{@const personForm = updatePerson.for(person.id)}
					{@const dropPerson = removePerson.for(person.id)}
					<tr>
						<td class="cell-primary">
							<a
								class="link font-medium"
								href={resolve('/staff/contacts/people/[id]', { id: person.id })}
								>{person.name ?? m.staff_contacts_unnamed_text()}</a
							>
							{#if person.role}<div class="truncate text-muted">{person.role}</div>{/if}
						</td>
						<td>{person.email ?? '—'}</td>
						<td class="col-support">{person.phone ?? '—'}</td>
						{#if org.canManage}
							<td class="w-px whitespace-nowrap">
								<Action
									action={personForm}
									label={m.staff_edit_label()}
									variant="ghost"
									size="xs"
									modalTitle={m.staff_edit_2_title({
										name: person.name ?? m.staff_contacts_unnamed_text()
									})}
									submitLabel={m.staff_save_label()}
									successToast={m.staff_saved_toast()}
								>
									{#snippet form()}
										<input {...personForm.fields.id.as('hidden', person.id)} />
										<input {...personForm.fields.organizationId.as('hidden', org.id)} />
										<PersonFields fields={personForm.fields} value={person} />
									{/snippet}
								</Action>
								<Action
									action={dropPerson}
									label={m.staff_remove_label()}
									variant="ghost"
									size="xs"
									modalTitle={m.staff_contacts_remove_person_title()}
									submitVariant="error"
									successToast={m.staff_removed_toast()}
								>
									{#snippet form()}
										<input {...dropPerson.fields.id.as('hidden', person.id)} />
										<input {...dropPerson.fields.organizationId.as('hidden', org.id)} />
										<p>{m.staff_contacts_remove_person_body()}</p>
									{/snippet}
								</Action>
							</td>
						{/if}
					</tr>
				{/each}
			</Table>
		{/if}
	</InfoCard>

	{#if org.roles.includes('funder') || org.records.grants.length > 0}
		<InfoCard title={m.staff_contacts_grant_applications_title()}>
			{#if org.records.grants.length === 0}
				<p class="text-muted">{m.staff_contacts_no_records_text()}</p>
			{:else}
				<ul class="space-y-1">
					{#each org.records.grants as g (g.id)}
						<li>
							<a class="link" href={resolve(`staff/grants/${g.id}`)}>{g.title}</a>
							<span class="text-muted">· {grantStatusLabels[g.status]}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/if}

	{#if org.roles.includes('sponsor') || org.records.sponsorships.length > 0}
		<InfoCard title={m.staff_contacts_sponsorships_title()}>
			{#if org.records.sponsorships.length === 0}
				<p class="text-muted">{m.staff_contacts_no_records_text()}</p>
			{:else}
				<ul class="space-y-1">
					{#each org.records.sponsorships as s (s.id)}
						<li>
							<a class="link" href={resolve(`staff/sponsors/${org.id}`)}>{s.title}</a>
							<span class="text-muted">· {sponsorshipStatusLabels[s.status]}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/if}

	{#if org.roles.includes('contractor') || org.records.jobs.length > 0}
		<InfoCard title={m.staff_contacts_contractor_jobs_title()}>
			{#if org.contractor?.insuranceExpiresAt}
				<p class="text-muted text-sm">
					{m.staff_insurance_label()}: {formatDateShort(org.contractor.insuranceExpiresAt)}
				</p>
			{/if}
			{#if org.records.jobs.length === 0}
				<p class="text-muted">{m.staff_contacts_no_records_text()}</p>
			{:else}
				<ul class="space-y-1">
					{#each org.records.jobs as j (j.id)}
						<li>
							<a class="link" href={resolve(`staff/contractors/jobs/${j.id}`)}>{j.title}</a>
							<span class="text-muted">· {contractorJobStatusLabels[j.status]}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/if}

	{#if org.roles.includes('vendor') || org.records.markets.length > 0}
		<InfoCard title={m.staff_contacts_market_applications_title()}>
			{#snippet action()}
				{#if org.canManage && org.roles.includes('vendor')}
					<Action
						action={saveVendorDetail}
						label={m.staff_contacts_edit_setup_label()}
						variant="ghost"
						size="sm"
						modalTitle={m.staff_contacts_edit_setup_title()}
						submitLabel={m.staff_save_label()}
						successToast={m.staff_saved_toast()}
					>
						{#snippet form()}
							{@const f = saveVendorDetail.fields}
							<input {...f.id.as('hidden', org.id)} />
							<Field
								field={f.offering}
								type="text"
								label={m.staff_contacts_products_label()}
								value={org.vendor?.offering ?? ''}
							/>
							<Field
								field={f.tablesNeeded}
								type="number"
								label={m.staff_contacts_tables_needed_label()}
								value={org.vendor?.tablesNeeded ?? 1}
								min="1"
								max={MARKET_MAX_TABLES_REQUESTED}
							/>
							<Field
								field={f.needsPower}
								type="checkbox"
								label={m.staff_contacts_power_label()}
								checkboxLabel={m.staff_contacts_needs_power_checkbox()}
								value={org.vendor?.needsPower ?? false}
							/>
							<Field
								field={f.bringsOwnTable}
								type="checkbox"
								label={m.staff_contacts_own_table_label()}
								checkboxLabel={m.staff_contacts_own_table_checkbox()}
								value={org.vendor?.bringsOwnTable ?? false}
							/>
							<Field
								field={f.bringsTent}
								type="checkbox"
								label={m.staff_contacts_tent_label()}
								checkboxLabel={m.staff_contacts_tent_checkbox()}
								value={org.vendor?.bringsTent ?? false}
							/>
							<Field
								field={f.setupNotes}
								type="text"
								label={m.staff_contacts_setup_notes_label()}
								value={org.vendor?.setupNotes ?? ''}
							/>
						{/snippet}
					</Action>
				{/if}
			{/snippet}
			{#if org.vendor}
				<DefinitionList>
					<Fact label={m.staff_contacts_products_label()}>{org.vendor.offering ?? '—'}</Fact>
					<Fact label={m.staff_contacts_tables_needed_label()}>{org.vendor.tablesNeeded}</Fact>
					<Fact label={m.staff_contacts_setup_label()}>
						{[
							org.vendor.needsPower && m.staff_contacts_needs_power_checkbox(),
							org.vendor.bringsOwnTable && m.staff_contacts_own_table_checkbox(),
							org.vendor.bringsTent && m.staff_contacts_tent_checkbox()
						]
							.filter(Boolean)
							.join(', ') || '—'}
					</Fact>
					<Fact label={m.staff_contacts_setup_notes_label()}>{org.vendor.setupNotes ?? '—'}</Fact>
				</DefinitionList>
			{:else if org.roles.includes('vendor')}
				<p class="text-muted">{m.staff_contacts_no_setup_text()}</p>
			{/if}
			{#if org.records.markets.length === 0}
				<p class="text-muted">{m.staff_contacts_no_records_text()}</p>
			{:else}
				<ul class="mt-3 space-y-1">
					{#each org.records.markets as a (a.id)}
						<li>
							<a class="link" href={resolve(`staff/events/${a.eventId}/vendors`)}>{a.title}</a>
							<span class="text-muted"
								>· {formatDateShort(a.startsAt)} · {marketVendorStatusLabels[a.status]}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/if}

	{#if org.roles.includes('supplier') || org.records.orders.length > 0}
		<InfoCard title={m.staff_contacts_purchase_orders_title()}>
			{#if org.records.orders.length === 0}
				<p class="text-muted">{m.staff_contacts_no_records_text()}</p>
			{:else}
				<ul class="space-y-1">
					{#each org.records.orders as o (o.id)}
						<li>
							<a class="link" href={resolve(`staff/inventory/orders/${o.id}`)}
								>{o.reference ??
									(o.placedAt ? formatDateShort(o.placedAt) : m.staff_order_2_label())}</a
							>
							<span class="text-muted">· {orderStatusLabels[o.status]}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</InfoCard>
	{/if}

	{#if org.people !== null}
		<PartyTimeline party={{ type: 'organization', id: org.id }} canManage={org.canManage} />
	{/if}
	<RelatedTasks subject={{ type: 'organization', id: org.id }} />
	<RelatedShifts subject={{ type: 'organization', id: org.id }} />
</PageContent>
