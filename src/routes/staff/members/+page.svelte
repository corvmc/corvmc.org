<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Roster from '$lib/components/roster/Roster.svelte';
	import { rosterState } from '$lib/components/roster/roster-state.svelte';
	import { oneOf } from '$lib/urlState.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import { IconUserOff } from '@tabler/icons-svelte';
	import {
		getStaffUsers,
		getStaffUserEmails,
		getStaffUserTotals,
		bulkDeactivateUsers
	} from '$lib/remote/users.remote';
	import { formatDateShortYear } from '$lib/utils/format';
	import { retryQuery } from '$lib/utils/retry-query';
	import UserTotals from './UserTotals.svelte';
	import InviteMemberAction from './InviteMemberAction.svelte';
	import MemberViews from './MemberViews.svelte';
	import MemberRecordPanel from './[id]/MemberRecordPanel.svelte';

	type YesNo = '' | 'yes' | 'no';
	const yesNo = () => oneOf<YesNo>(['', 'yes', 'no'], '');

	const roster = rosterState(resolve('/staff/members'), {
		status: oneOf(['active', 'deactivated', 'all'] as const, 'active'),
		sustaining: yesNo(),
		inBand: yesNo(),
		staff: yesNo(),
		instructor: yesNo()
	});
	const f = roster.values;

	const flagFilters = [
		{ key: 'sustaining', label: m.staff_members_sustaining_member() },
		{ key: 'inBand', label: m.staff_members_band() },
		{ key: 'staff', label: m.staff_members_staff_position() },
		{ key: 'instructor', label: m.staff_members_teaching_instructor() }
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

<PageHeader title={m.staff_members()}>
	<MemberViews active="all" />
</PageHeader>

<PageContent>
	<svelte:boundary>
		<UserTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffUserTotals(), reset)}>
				{m.staff_members_totals_didn_t_load()}
			</Alert>
		{/snippet}
	</svelte:boundary>

	<Roster
		{roster}
		result={list}
		empty={m.staff_members_empty()}
		searchPlaceholder={m.staff_search_by_name_email()}
		exportPath={resolve('/staff/members/export')}
		emails={() => getStaffUserEmails({ ...f, q: f.q || undefined })}
	>
		{#snippet toolbar()}
			<InviteMemberAction />
		{/snippet}

		{#snippet filters()}
			<Select
				size="sm"
				aria-label={m.staff_status()}
				value={f.status}
				onchange={(e: Event) =>
					setFilter('status', (e.currentTarget as HTMLSelectElement).value as typeof f.status)}
			>
				<option value="active">{m.staff_active()}</option>
				<option value="deactivated">{m.staff_deactivated()}</option>
				<option value="all">{m.staff_all_statuses()}</option>
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
						<option value="">{m.staff_members_either()}</option>
						<option value="yes">{m.staff_yes()}</option>
						<option value="no">{m.staff_members_no()}</option>
					</Select>
				</label>
			{/each}
		{/snippet}

		{#snippet summary(total)}
			{total}
			{total === 1 ? m.staff_member_2() : m.staff_members_2()}
		{/snippet}

		{#snippet bulk()}
			{#if selected.size > 0}
				<span class="text-sm" data-testid="selected-count"
					>{m.staff_members_selected({ size: selected.size })}</span
				>
				<Action
					action={bulkDeactivateUsers}
					label={m.staff_deactivate()}
					variant="error"
					size="sm"
					modalTitle={m.staff_members_modal_title()}
					submitLabel={m.staff_deactivate()}
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
							{m.staff_members_deactivate_selected_members_their_future({ size: selected.size })}
						</p>
					{/snippet}
				</Action>
				<Button variant="ghost" size="sm" onclick={() => selected.clear()}
					>{m.staff_members_clear()}</Button
				>
			{/if}
		{/snippet}

		{#snippet leadHead(rows)}
			{@const ids = selectable(rows)}
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				aria-label={m.staff_members_select_all_page()}
				disabled={ids.length === 0}
				checked={ids.length > 0 && ids.every((id) => selected.has(id))}
				onchange={(e) => toggleAll(rows, e.currentTarget.checked)}
			/>
		{/snippet}

		{#snippet lead(row)}
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				aria-label={m.staff_members_select({ title: row.member.title })}
				disabled={!!row.deletedAt}
				checked={selected.has(row.id)}
				onchange={(e) => {
					if (e.currentTarget.checked) selected.add(row.id);
					else selected.delete(row.id);
				}}
			/>
		{/snippet}

		{#snippet columns()}
			<th class="col-support">{m.staff_phone()}</th>
			<th class="col-support">{m.staff_membership()}</th>
			<th class="col-support">{m.staff_joined()}</th>
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
					<Badge size="sm" class="badge-primary">{m.staff_sustaining()}</Badge>
				{:else}
					<span class="text-fg-3">{m.staff_members_free()}</span>
				{/if}
			</td>
			<td class="col-support whitespace-nowrap">{formatDateShortYear(row.createdAt)}</td>
		{/snippet}

		{#snippet panel(row, ctl)}
			<MemberRecordPanel id={row.personId} name={row.member.title} bind:open={ctl.open} />
		{/snippet}
	</Roster>
</PageContent>
