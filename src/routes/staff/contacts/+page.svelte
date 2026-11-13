<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** Every outside organization, one view per role (#2622). */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import OrganizationFields from './OrganizationFields.svelte';
	import {
		createOrganization,
		getContactsPage,
		type ContactsView
	} from '#lib/remote/contacts.remote.js';
	import { partyRoleLabels, partyRoles, partyRoleViewLabels, type PartyRole } from '#lib/config.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import { withQuery } from '#lib/utils/with-query.js';
	import { clubInstant, formatDateShort } from '#lib/utils/format.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const requested = $derived(
		(page.url.searchParams.get('view') as ContactsView | null) ?? undefined
	);
	const includeArchived = $derived(page.url.searchParams.get('archived') === '1');
	// One query: it settles which view the viewer may open, and lists it.
	const data = $derived(await getContactsPage({ view: requested, includeArchived }));
	const views = $derived(data.views);
	const view = $derived(data.view);
	const rows = $derived(data.rows);

	const href = (key: ContactsView) =>
		withQuery(resolve('staff/contacts'), new URLSearchParams({ view: key }));
	const tabs = $derived([
		...(views.all ? [{ key: 'all', label: m.staff_all_label(), href: href('all') }] : []),
		...views.roles.map((r) => ({ key: r, label: partyRoleViewLabels[r], href: href(r) }))
	]);

	// Contractors carry a trade, so they are added from their own page.
	const roleOptions = partyRoles
		.filter((r) => r !== 'contractor')
		.map((r) => ({ value: r, label: partyRoleLabels[r] }));
	const defaultRole = $derived<PartyRole>(
		view !== 'all' && view !== 'contractor' ? view : 'partner'
	);

	function setArchived(on: boolean) {
		const url = new URL(page.url.href);
		if (on) url.searchParams.set('archived', '1');
		else url.searchParams.delete('archived');
		goto(url, { replace: true });
	}
</script>

<PageHeader title={m.staff_contacts_title()} subtitle={m.staff_contacts_body()}>
	{#if view === 'contractor'}
		<Button variant="ghost" size="sm" href={resolve('staff/contractors')}>
			{m.staff_contacts_contractors_page_label()}
		</Button>
	{:else if view === 'sponsor'}
		<Button variant="ghost" size="sm" href={resolve('staff/funding')}>
			{m.staff_contacts_sponsorships_page_label()}
		</Button>
	{:else if view === 'funder'}
		<Button variant="ghost" size="sm" href={resolve('staff/funding')}>
			{m.staff_contacts_grants_page_label()}
		</Button>
	{/if}
	{#if views.all}
		<Button variant="ghost" size="sm" href={resolve('staff/contacts/duplicates')}>
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
					value={defaultRole}
					description={m.staff_contacts_contractor_hint_body()}
				/>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	{#if tabs.length > 1}
		<TabBar collapse active={view} {tabs} />
	{/if}

	<div class="flex justify-end">
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={includeArchived}
				onchange={(e) => setArchived(e.currentTarget.checked)}
			/>
			{m.staff_show_archived_label()}
		</label>
	</div>

	{#if rows.length === 0}
		<EmptyState
			title={m.staff_contacts_no_organizations_title()}
			description={m.staff_contacts_no_organizations_body()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_contacts_organization_label()}</th>
				{#if views.all}
					<th>{m.staff_contacts_main_person_label()}</th>
				{/if}
				<th class="col-support">{m.staff_contacts_last_activity_label()}</th>
				<th class="col-support">{m.staff_contacts_next_task_label()}</th>
				<th class="col-support">{m.staff_website_label()}</th>
			{/snippet}
			{#each rows as row (row.id)}
				<tr
					class="hover cursor-pointer"
					class:opacity-60={row.archivedAt}
					use:rowLink={resolve(`staff/contacts/${row.id}`)}
				>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`staff/contacts/${row.id}`)}>{row.name}</a>
						{#if row.archivedAt}
							<Badge variant="ghost" size="sm" class="ml-2">{m.staff_archived_label()}</Badge>
						{/if}
						<div class="truncate text-muted">
							{row.roles.map((r) => partyRoleLabels[r]).join(', ')}
						</div>
					</td>
					{#if views.all}
						<td>{row.mainPerson ?? '—'}</td>
					{/if}
					<td class="col-support">
						{row.lastActivity ? formatDateShort(clubInstant(row.lastActivity, '12:00')) : '—'}
					</td>
					<td class="col-support truncate">
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
					<td class="col-support truncate">{row.website ?? '—'}</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={rows.length} unit="organizations" />
	{/if}
</PageContent>
