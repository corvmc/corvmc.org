<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import Roster from '#lib/components/roster/Roster.svelte';
	import { rosterState } from '#lib/components/roster/roster-state.svelte.js';
	import { oneOf } from '#lib/urlState.svelte.js';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import { IconUserOff } from '@tabler/icons-svelte';
	import {
		getStaffUsers,
		getStaffUserEmails,
		getStaffUserTotals,
		bulkDeactivateUsers
	} from '#lib/remote/users.remote.js';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import UserTotals from './UserTotals.svelte';
	import InviteMemberAction from './InviteMemberAction.svelte';
	import MemberViews from './MemberViews.svelte';
	import MemberRecordPanel from './[id]/MemberRecordPanel.svelte';

	type YesNo = '' | 'yes' | 'no';
	const yesNo = () => oneOf<YesNo>(['', 'yes', 'no'], '');

	const roster = rosterState(resolve('staff/members'), {
		status: oneOf(['active', 'deactivated', 'all'] as const, 'active'),
		sustaining: yesNo(),
		inBand: yesNo(),
		staff: yesNo(),
		instructor: yesNo()
	});
	const f = roster.values;

	const flagFilters = [
		{ key: 'sustaining', label: m.staff_members_sustaining_member_label() },
		{ key: 'inBand', label: m.staff_members_band_label() },
		{ key: 'staff', label: m.staff_members_staff_position_label() },
		{ key: 'instructor', label: m.staff_members_teaching_instructor_label() }
	] as const;

	const asBool = (v: YesNo) => (v === '' ? undefined : v === 'yes');
	const filters = $derived({
		search: f.q || undefined,
		status: f.status,
		sustaining: asBool(f.sustaining),
		inBand: asBool(f.inBand),
		staff: asBool(f.staff),
		instructor: asBool(f.instructor),
		page: f.page
	});
	const list = $derived(getStaffUsers(filters));
	type User = Awaited<typeof list>['rows'][number];

	// Scoped to the rows on screen, so the bulk count is what the operator can see.
	const selected = new SvelteSet<string>();
	$effect(() => {
		void filters;
		selected.clear();
	});
	const { fields: bulkFields } = bulkDeactivateUsers;

	const selectable = (rows: User[]) => rows.filter((u) => !u.deletedAt).map((u) => u.id);
	function toggleAll(rows: User[], checked: boolean) {
		for (const id of selectable(rows)) {
			if (checked) selected.add(id);
			else selected.delete(id);
		}
	}

	function setFilter<K extends keyof typeof f>(key: K, value: (typeof f)[K]) {
		f[key] = value;
		f.page = 1;
	}
</script>

<PageHeader title={m.staff_members_title()}>
	<MemberViews active="all" />
</PageHeader>

<PageContent>
	<svelte:boundary>
		<UserTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffUserTotals(), reset)}>
				{m.staff_members_totals_didn_t_load_body()}
			</Alert>
		{/snippet}
	</svelte:boundary>

	<Roster
		{roster}
		result={list}
		empty={m.staff_members_empty_body()}
		searchPlaceholder={m.staff_search_by_name_email_placeholder()}
		exportPath={resolve('staff/members/export')}
		emails={() => getStaffUserEmails({ ...f, q: f.q || undefined })}
	>
		{#snippet toolbar()}
			<InviteMemberAction />
		{/snippet}

		{#snippet filters()}
			<Select
				size="sm"
				aria-label={m.staff_status_label()}
				value={f.status}
				onchange={(e: Event) =>
					setFilter('status', (e.currentTarget as HTMLSelectElement).value as typeof f.status)}
			>
				<option value="active">{m.staff_active_label()}</option>
				<option value="deactivated">{m.staff_deactivated_label()}</option>
				<option value="all">{m.staff_all_statuses_label()}</option>
			</Select>
		{/snippet}

		{#snippet menu()}
			{#each flagFilters as x (x.key)}
				<label class="flex flex-col gap-1">
					<span class="text-muted text-xs">{x.label}</span>
					<Select
						size="sm"
						value={f[x.key]}
						onchange={(e: Event) =>
							setFilter(x.key, (e.currentTarget as HTMLSelectElement).value as YesNo)}
					>
						<option value="">{m.staff_members_either_label()}</option>
						<option value="yes">{m.staff_yes_label()}</option>
						<option value="no">{m.staff_members_no_label()}</option>
					</Select>
				</label>
			{/each}
		{/snippet}

		{#snippet summary(total)}
			{total}
			{total === 1 ? m.staff_member_2_text() : m.staff_members_2_text()}
		{/snippet}

		{#snippet bulk()}
			{#if selected.size > 0}
				<span class="text-sm" data-testid="selected-count"
					>{m.staff_members_selected_text({ size: selected.size })}</span
				>
				<Action
					action={bulkDeactivateUsers}
					label={m.staff_deactivate_label()}
					variant="error"
					size="sm"
					modalTitle={m.staff_members_modal_title()}
					submitLabel={m.staff_deactivate_label()}
					submitVariant="error"
					onsuccess={(result) => {
						const r = result as { deactivated: string[]; skipped: string[] };
						selected.clear();
						void list.refresh();
						const skipped = r.skipped.length ? `, ${r.skipped.length} skipped` : '';
						toast.success(m.staff_members_toast({ length: r.deactivated.length, skipped }));
					}}
				>
					{#snippet icon()}
						<IconUserOff size={16} />
					{/snippet}
					{#snippet form()}
						<input {...bulkFields.ids.as('hidden', JSON.stringify([...selected]))} />
						<p class="py-2">
							{m.staff_members_deactivate_selected_members_their_future_text({
								size: selected.size
							})}
						</p>
					{/snippet}
				</Action>
				<Button variant="ghost" size="sm" onclick={() => selected.clear()}
					>{m.staff_members_clear_label()}</Button
				>
			{/if}
		{/snippet}

		{#snippet leadHead(rows)}
			{@const ids = selectable(rows)}
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				aria-label={m.staff_members_select_all_page_label()}
				disabled={ids.length === 0}
				checked={ids.length > 0 && ids.every((id) => selected.has(id))}
				onchange={(e) => toggleAll(rows, e.currentTarget.checked)}
			/>
		{/snippet}

		{#snippet lead(row)}
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				aria-label={m.staff_members_select_label({ title: row.member.title })}
				disabled={!!row.deletedAt}
				checked={selected.has(row.id)}
				onchange={(e) => {
					if (e.currentTarget.checked) selected.add(row.id);
					else selected.delete(row.id);
				}}
			/>
		{/snippet}

		{#snippet columns()}
			<th class="col-support">{m.staff_phone_label()}</th>
			<th class="col-support">{m.staff_membership_label()}</th>
			<th class="col-support">{m.staff_joined_label()}</th>
		{/snippet}

		{#snippet cells(row)}
			<td class="col-support whitespace-nowrap">
				{#if row.phone}
					<a class="hover:underline" href="tel:{row.phone}">{row.phone}</a>
				{:else}
					<span class="text-fg-3">—</span>
				{/if}
			</td>
			<td class="col-support whitespace-nowrap">
				{#if row.sustaining}
					<Badge size="sm" class="badge-primary">{m.staff_sustaining_label()}</Badge>
				{:else}
					<span class="text-fg-3">{m.staff_members_free_text()}</span>
				{/if}
			</td>
			<td class="col-support whitespace-nowrap">{formatDateShortYear(row.createdAt)}</td>
		{/snippet}

		{#snippet panel(row, ctl)}
			<MemberRecordPanel id={row.personId} name={row.member.title} bind:open={ctl.open} />
		{/snippet}
	</Roster>
</PageContent>
