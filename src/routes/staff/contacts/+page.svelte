<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/** Every outside organization and every person with none, in one table (#2760). */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import SortHeader from '#lib/components/ui/SortHeader.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import OrganizationFields from './OrganizationFields.svelte';
	import CreateActAction from './CreateActAction.svelte';
	import { createOrganization, getContactsPage } from '#lib/remote/contacts.remote.js';
	import { createContractorForm } from '#lib/remote/contractors.remote.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { withQuery } from '#lib/utils/with-query.js';
	import { contractorTradeLabels, contractorTrades } from '#lib/config.js';
	import {
		contactListSorts,
		contactListTypes,
		partyRoleLabels,
		partyRoles,
		partyRoleViewLabels,
		type ContactListSort,
		type ContactListType
	} from '#lib/config.js';
	import { urlState, oneOf, positiveInt, text } from '#lib/urlState.svelte.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import { clubInstant, formatDateShort } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { defaultCreateRole, parseRoles, toggleRole } from './contact-filters';

	const f = urlState(resolve('staff/contacts'), {
		q: text(),
		role: text(),
		type: oneOf(['', ...contactListTypes] as const, ''),
		archived: oneOf(['', '1'] as const, ''),
		sort: oneOf(contactListSorts, 'name'),
		page: positiveInt(1)
	});
	// `searchText`, not `search`: FilterBar's `search` snippet would shadow it.
	let searchText = $state(f.q);
	const roles = $derived(parseRoles(f.role));
	const menuCount = $derived((roles.length > 0 ? 1 : 0) + (f.archived ? 1 : 0));
	const activeCount = $derived(menuCount + (f.q ? 1 : 0) + (f.type ? 1 : 0));

	function clear() {
		searchText = '';
		f.q = '';
		f.role = '';
		f.type = '';
		f.archived = '';
		f.page = 1;
	}

	function setSort(next: string) {
		f.sort = next as ContactListSort;
		f.page = 1;
	}

	const contractorFields = createContractorForm.fields;
	const tradeOptions = contractorTrades.map((t) => ({ value: t, label: contractorTradeLabels[t] }));

	// Contractors carry a trade, so they are added from the contractor view's own action.
	const roleOptions = partyRoles
		.filter((r) => r !== 'contractor')
		.map((r) => ({ value: r, label: partyRoleLabels[r] }));

	// One query: it settles which roles the viewer may read, and lists them.
	const data = $derived(
		await getContactsPage({
			roles: roles.length > 0 ? roles : undefined,
			type: f.type || undefined,
			search: f.q || undefined,
			includeArchived: f.archived === '1',
			sort: f.sort,
			page: f.page
		})
	);
	const only = $derived(roles.length === 1 ? roles[0] : null);
	const href = (row: { type: ContactListType; id: string }) =>
		row.type === 'person'
			? resolve('/staff/contacts/people/[id]', { id: row.id })
			: resolve('/staff/contacts/[id]', { id: row.id });
</script>

<PageHeader title={m.staff_contacts_title()} subtitle={m.staff_contacts_body()}>
	{#if only === 'contractor'}
		<Button variant="ghost" href={withQuery(resolve('staff/tasks'), 'kind=contractor')}
			>{m.staff_jobs_label()}</Button
		>
		{#if data.canAddContractor}
			<Action
				action={createContractorForm}
				label={m.staff_contractors_new_contractor_label()}
				modalTitle={m.staff_contractors_new_contractor_title()}
				successToast={m.staff_contractors_success_toast()}
				onsuccess={(r) => {
					const id = (r as { id?: string } | undefined)?.id;
					if (id) goto(resolve(`staff/contacts/${id}`));
				}}
			>
				{#snippet form()}
					<Field field={contractorFields.name} type="text" label={m.staff_name_label()} />
					<Field
						field={contractorFields.trade}
						type="select"
						label={m.staff_trade_label()}
						options={tradeOptions}
					/>
					<Field field={contractorFields.contactName} type="text" label={m.staff_contact_label()} />
					<Field field={contractorFields.phone} type="tel" label={m.staff_phone_label()} />
					<Field field={contractorFields.email} type="email" label={m.staff_email_label()} />
					<Field
						field={contractorFields.licenseNumber}
						type="text"
						label={m.staff_licence_number_label()}
					/>
					<Field
						field={contractorFields.insuranceExpiresAt}
						type="date"
						label={m.staff_insurance_expires_label()}
						description={m.staff_contractors_leave_blank_if_we_hold_body()}
					/>
					<Field field={contractorFields.notes} type="textarea" label={m.staff_notes_label()} />
				{/snippet}
			</Action>
		{/if}
	{:else if only === 'performer'}
		<CreateActAction />
	{:else if only === 'sponsor'}
		<Button variant="ghost" href={resolve('staff/funding')}>
			{m.staff_contacts_sponsorships_page_label()}
		</Button>
	{:else if only === 'funder'}
		<Button variant="ghost" href={resolve('staff/funding')}>
			{m.staff_contacts_grants_page_label()}
		</Button>
	{/if}
	{#if data.people}
		<Button variant="ghost" href={resolve('staff/contacts/duplicates')}>
			{m.staff_contacts_duplicates_label()}
		</Button>
		<Action
			action={createOrganization}
			label={m.staff_contacts_add_organization_label()}
			modalTitle={m.staff_contacts_add_organization_title()}
			successToast={m.staff_contacts_organization_added_toast()}
			onsuccess={(r) => {
				const id = (r as { id?: string } | undefined)?.id;
				if (id) goto(resolve(`staff/contacts/${id}`));
			}}
			data-testid="new-organization"
		>
			{#snippet form()}
				<OrganizationFields fields={createOrganization.fields} />
				<Field
					field={createOrganization.fields.role}
					type="select"
					label={m.staff_role_label()}
					options={roleOptions}
					value={defaultCreateRole(roles)}
					description={m.staff_contacts_contractor_hint_body()}
				/>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	{#if data.contractorWarnings}
		{@const w = data.contractorWarnings}
		{#if w.overdue > 0}
			<Alert type="warning">
				<ParaglideMessage
					message={m.staff_contractors_jobs_past_date_they_were_body}
					inputs={{
						staff_contractors_overdue: m.staff_contractors_overdue_body(),
						length: w.overdue,
						staff_contractors_open_queue: m.staff_contractors_open_queue_body()
					}}
					>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
						>{/snippet}{#snippet a({ children })}<a
							class="link"
							href={withQuery(resolve('staff/tasks'), 'kind=contractor')}>{@render children?.()}</a
						>{/snippet}</ParaglideMessage
				>
			</Alert>
		{/if}
		{#if w.lapsing.length > 0}
			<Alert type="error">
				<span class="font-medium">{m.staff_insurance_body()}</span>
				{#each w.lapsing as c (c.id)}
					<div>
						<a class="link font-medium" href={resolve(`staff/contacts/${c.id}`)}>{c.name}</a>
						{#if c.insuranceExpiresAt}
							— {c.insuranceExpiresAt < new Date()
								? m.staff_contractors_expired_2_text()
								: m.staff_contractors_expires_text()}
							{formatDateShort(c.insuranceExpiresAt)}
						{/if}
					</div>
				{/each}
			</Alert>
		{/if}
	{/if}

	<FilterBar {activeCount} {menuCount} onclear={clear}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_contacts_search_placeholder()}
				onsearch={(q) => {
					f.q = q;
					f.page = 1;
				}}
			/>
		{/snippet}
		{#if data.people}
			<Select
				size="sm"
				aria-label={m.staff_type_label()}
				data-testid="type-filter"
				value={f.type}
				onchange={(e: Event) => {
					f.type = (e.currentTarget as HTMLSelectElement).value as typeof f.type;
					f.page = 1;
				}}
			>
				<option value="">{m.staff_contacts_all_types_label()}</option>
				<option value="organization">{m.staff_contacts_organizations_label()}</option>
				<option value="person">{m.staff_people_label()}</option>
			</Select>
		{/if}
		{#snippet menu()}
			{#if data.roles.length > 1}
				<fieldset class="flex flex-col gap-1" data-testid="role-filter">
					<legend class="mb-1 text-muted text-xs">{m.staff_contacts_roles_title()}</legend>
					{#each data.roles as role (role)}
						<label class="label cursor-pointer gap-2 text-sm">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								value={role}
								checked={roles.includes(role)}
								onchange={(e) => {
									f.role = toggleRole(f.role, role, e.currentTarget.checked);
									f.page = 1;
								}}
							/>
							{partyRoleViewLabels[role]}
						</label>
					{/each}
				</fieldset>
			{/if}
			<label class="label cursor-pointer gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					name="archived"
					checked={f.archived === '1'}
					onchange={(e) => {
						f.archived = e.currentTarget.checked ? '1' : '';
						f.page = 1;
					}}
				/>
				{m.staff_show_archived_label()}
			</label>
		{/snippet}
	</FilterBar>

	{#if data.rows.length === 0}
		<EmptyState
			title={m.staff_contacts_no_contacts_title()}
			description={m.staff_contacts_no_contacts_body()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<SortHeader label={m.staff_name_label()} field="name" sort={data.sort} onsort={setSort} />
				{#if data.people}
					<th>{m.staff_contacts_main_person_label()}</th>
				{/if}
				{#if data.sortable.activity}
					<SortHeader
						class="col-support"
						label={m.staff_contacts_last_activity_label()}
						field="activity"
						descFirst
						sort={data.sort}
						onsort={setSort}
					/>
				{:else}
					<th class="col-support">{m.staff_contacts_last_activity_label()}</th>
				{/if}
				{#if data.sortable.task}
					<SortHeader
						class="col-support"
						label={m.staff_contacts_next_task_label()}
						field="task"
						sort={data.sort}
						onsort={setSort}
					/>
				{:else}
					<th class="col-support">{m.staff_contacts_next_task_label()}</th>
				{/if}
				<th class="col-support">{m.staff_website_label()}</th>
			{/snippet}
			{#each data.rows as row (`${row.type}:${row.id}`)}
				<tr
					class="hover cursor-pointer"
					class:opacity-60={row.archivedAt}
					data-type={row.type}
					use:rowLink={href(row)}
				>
					<td class="cell-primary">
						<a class="link font-medium" href={href(row)}
							>{row.name ?? m.staff_contacts_unnamed_text()}</a
						>
						{#if row.archivedAt}
							<Badge variant="ghost" size="sm" class="ml-2">{m.staff_archived_label()}</Badge>
						{/if}
						<div class="truncate text-muted">
							{#if row.roles.length > 0}
								{row.roles.map((r) => partyRoleLabels[r]).join(', ')}
							{:else if row.type === 'person'}
								{m.staff_contacts_person_text()}
							{/if}
						</div>
					</td>
					{#if data.people}
						<td class="cell-text truncate">{row.mainPerson ?? '—'}</td>
					{/if}
					<td class="col-support whitespace-nowrap">
						{row.lastActivity ? formatDateShort(clubInstant(row.lastActivity, '12:00')) : '—'}
					</td>
					<td class="col-support cell-text truncate">
						{#if row.nextTask}
							<a class="link" href={resolve('/staff/tasks/[id]', { id: row.nextTask.id })}
								>{row.nextTask.title}</a
							>
							{#if row.nextTask.dueAt}
								<div class="text-muted">{formatDateShort(row.nextTask.dueAt)}</div>
							{/if}
						{:else}
							—
						{/if}
					</td>
					<td class="col-support cell-text truncate">{row.website ?? '—'}</td>
				</tr>
			{/each}
		</Table>
		<Pagination
			page={data.pagination.page}
			totalPages={data.pagination.totalPages}
			pageSize={data.pagination.pageSize}
			total={data.pagination.total}
			unit="contacts"
			onpage={(p) => (f.page = p)}
		/>
	{/if}
</PageContent>
