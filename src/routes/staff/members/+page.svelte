<script lang="ts">
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
		{ key: 'sustaining', label: 'Sustaining member' },
		{ key: 'inBand', label: 'In a band' },
		{ key: 'staff', label: 'Staff position' },
		{ key: 'instructor', label: 'Teaching instructor' }
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

<PageHeader title="Members">
	<InviteMemberAction />
</PageHeader>

<PageContent>
	<svelte:boundary>
		<UserTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffUserTotals(), reset)}>
				The totals didn't load.
			</Alert>
		{/snippet}
	</svelte:boundary>

	<Roster
		{roster}
		result={list}
		empty="No members found"
		searchPlaceholder="Search by name or email..."
		exportPath={resolve('/staff/members/export')}
		emails={() => getStaffUserEmails({ ...f, q: f.q || undefined })}
	>
		{#snippet filters()}
			<Select
				size="sm"
				aria-label="Status"
				value={f.status}
				onchange={(e: Event) =>
					setFilter('status', (e.currentTarget as HTMLSelectElement).value as typeof f.status)}
			>
				<option value="active">Active</option>
				<option value="deactivated">Deactivated</option>
				<option value="all">All statuses</option>
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
						<option value="">Either</option>
						<option value="yes">Yes</option>
						<option value="no">No</option>
					</Select>
				</label>
			{/each}
		{/snippet}

		{#snippet summary(total)}
			{total}
			{total === 1 ? 'member' : 'members'}
		{/snippet}

		{#snippet bulk()}
			{#if selected.size > 0}
				<span class="text-sm">{selected.size} selected</span>
				<Action
					action={bulkDeactivateUsers}
					label="Deactivate"
					variant="error"
					size="sm"
					modalTitle="Deactivate members"
					submitLabel="Deactivate"
					submitVariant="error"
					onsuccess={(result) => {
						const r = result as { deactivated: string[]; skipped: string[] };
						selected.clear();
						void list.refresh();
						const skipped = r.skipped.length ? `, ${r.skipped.length} skipped` : '';
						toast.success(`${r.deactivated.length} deactivated${skipped}`);
					}}
				>
					{#snippet icon()}
						<IconUserOff size={16} />
					{/snippet}
					{#snippet form()}
						<input {...bulkFields.ids.as('hidden', JSON.stringify([...selected]))} />
						<p class="py-2">
							Deactivate {selected.size} selected member{selected.size === 1 ? '' : 's'}? Their
							future personal reservations will be cancelled, and reactivating will not bring them
							back. Membership subscriptions end with their current period unless reactivated first.
							Your own account is skipped.
						</p>
					{/snippet}
				</Action>
				<Button variant="ghost" size="sm" onclick={() => selected.clear()}>Clear</Button>
			{/if}
		{/snippet}

		{#snippet leadHead(rows)}
			{@const ids = selectable(rows)}
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				aria-label="Select all on this page"
				disabled={ids.length === 0}
				checked={ids.length > 0 && ids.every((id) => selected.has(id))}
				onchange={(e) => toggleAll(rows, e.currentTarget.checked)}
			/>
		{/snippet}

		{#snippet lead(row)}
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				aria-label="Select {row.member.title}"
				disabled={!!row.deletedAt}
				checked={selected.has(row.id)}
				onchange={(e) => {
					if (e.currentTarget.checked) selected.add(row.id);
					else selected.delete(row.id);
				}}
			/>
		{/snippet}

		{#snippet columns()}
			<th class="col-support">Phone</th>
			<th class="col-support">Membership</th>
			<th class="col-support">Joined</th>
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
					<Badge size="sm" class="badge-primary">Sustaining</Badge>
				{:else}
					<span class="text-fg-3">Free</span>
				{/if}
			</td>
			<td class="col-support whitespace-nowrap">{formatDateShortYear(row.createdAt)}</td>
		{/snippet}
	</Roster>
</PageContent>
