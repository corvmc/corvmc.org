<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import RosterTable from '$lib/components/roster/RosterTable.svelte';
	import CopyEmailsButton from '$lib/components/roster/CopyEmailsButton.svelte';
	import CommitteeGrantsAction from '$lib/components/groups/CommitteeGrantsAction.svelte';
	import RevokeClearanceAction from './RevokeClearanceAction.svelte';
	import { getAccessPage, getAccessHolders } from '$lib/remote/access.remote';
	import { Latest } from '$lib/latest.svelte';
	import { positionLabels, positionOrder, type Capability, type Position } from '$lib/config';
	import type { RosterPerson } from '$lib/types/roster';
	import { formatDateShortYear } from '$lib/utils/format';
	import { capabilityLabel, everyCapability } from './capability-label';

	type Kind = 'capability' | 'position' | 'clearance';
	type ClearanceFilter = '' | 'current' | 'lapsing' | 'expiring' | 'expired' | 'revoked';

	let { certifications }: { certifications: { id: string; name: string; isActive: boolean }[] } =
		$props();

	let searchText = $state('');
	let nameFilter = $state('');
	let kind = $state<Kind>('position');
	let key = $state<string>('admin');
	let clearanceState = $state<ClearanceFilter>('');

	function pickKind(next: Kind) {
		kind = next;
		key =
			next === 'position'
				? 'admin'
				: next === 'capability'
					? everyCapability[0].caps[0]
					: (certifications[0]?.id ?? '');
		clearanceState = '';
	}

	const selection = $derived(
		kind === 'capability'
			? ({ kind, key: key as Capability } as const)
			: kind === 'position'
				? ({ kind, key: key as Position } as const)
				: ({ kind, key } as const)
	);
	const result = $derived(key ? getAccessHolders(selection) : null);
	// Not `{#await}`: a refresh would re-pend it and unmount an open grant dialog.
	// Tagged with its selection so a switch never shows one key's rows under another.
	const holders = new Latest(() => {
		const tag = `${kind}:${key}`;
		return result ? result.then((data) => ({ tag, data })) : Promise.resolve(null);
	});
	$effect(() => {
		if (holders.error) throw holders.error.e;
	});

	const matches = ({ member, email }: RosterPerson) =>
		!nameFilter ||
		`${member.title} ${email ?? ''}`.toLowerCase().includes(nameFilter.toLowerCase());

	function refresh() {
		if (key) void getAccessHolders(selection).refresh();
		void getAccessPage().refresh();
	}
</script>

{#snippet count(rows: RosterPerson[], label: string)}
	<div class="flex flex-wrap items-center justify-between gap-2">
		<p class="text-muted">{label}</p>
		{#if rows.length > 0}<CopyEmailsButton emails={rows.map((r) => r.email)} />{/if}
	</div>
{/snippet}

<FilterBar
	activeCount={(nameFilter ? 1 : 0) + (clearanceState ? 1 : 0)}
	onclear={() => {
		searchText = '';
		nameFilter = '';
		clearanceState = '';
	}}
>
	{#snippet search()}
		<SearchInput
			bind:value={searchText}
			placeholder={m.staff_access_permission_holders_placeholder()}
			onsearch={(q) => (nameFilter = q)}
		/>
	{/snippet}
	<Select
		size="sm"
		aria-label={m.staff_kind()}
		value={kind}
		onchange={(e: Event) => pickKind((e.currentTarget as HTMLSelectElement).value as Kind)}
	>
		<option value="position">{m.staff_position()}</option>
		<option value="capability">{m.staff_access_permission_holders_capability()}</option>
		<option value="clearance">{m.staff_clearance()}</option>
	</Select>
	<Select size="sm" aria-label={m.staff_access_permission_holders_which()} bind:value={key}>
		{#if kind === 'position'}
			{#each positionOrder as p (p)}
				<option value={p}>{positionLabels[p]}</option>
			{/each}
		{:else if kind === 'capability'}
			{#each everyCapability as g (g.resource)}
				<optgroup label={g.label}>
					{#each g.caps as cap (cap)}
						<option value={cap}>{capabilityLabel(cap)}</option>
					{/each}
				</optgroup>
			{/each}
		{:else}
			{#each certifications as c (c.id)}
				<option value={c.id}>{c.name}{c.isActive ? '' : ' (archived)'}</option>
			{/each}
		{/if}
	</Select>
	{#if kind === 'clearance'}
		<Select
			size="sm"
			aria-label={m.staff_access_permission_holders_clearance_state()}
			bind:value={clearanceState}
		>
			<option value="">{m.staff_access_permission_holders_every_state()}</option>
			<option value="current">{m.staff_access_permission_holders_current()}</option>
			<option value="lapsing">{m.staff_access_permission_holders_lapsing_30_days()}</option>
			<option value="expiring">{m.staff_access_permission_holders_expiring()}</option>
			<option value="expired">{m.staff_access_permission_holders_expired()}</option>
			<option value="revoked">{m.staff_access_permission_holders_revoked()}</option>
		</Select>
	{/if}
</FilterBar>

{#if !result}
	<EmptyState
		title={m.staff_access_permission_holders_nothing_pick()}
		description={m.staff_access_permission_holders_there_no_clearances_catalog()}
	/>
{:else if holders.current?.tag === `${kind}:${key}`}
	{@const data = holders.current.data}
	{#if data.kind === 'position'}
		{@const rows = data.members.filter(matches)}
		{@render count(rows, `${rows.length} of ${data.members.length} holding this position`)}
		{#if rows.length === 0}
			<EmptyState
				title={m.staff_access_permission_holders_nobody()}
				description={m.staff_access_permission_holders_no_one_holds_position()}
			/>
		{:else}
			<RosterTable {rows} personLabel={m.staff_access_permission_holders_person_label()} />
		{/if}
	{:else if data.kind === 'capability'}
		{@const rows = data.holders.filter(matches)}
		{@render count(rows, `${rows.length} of ${data.holders.length} holding this capability`)}
		{#if rows.length === 0}
			<EmptyState
				title={m.staff_access_permission_holders_nobody()}
				description={m.staff_access_permission_holders_no_position_committee_seat_c()}
			/>
		{:else}
			<RosterTable {rows} personLabel={m.staff_access_permission_holders_person_label()}>
				{#snippet columns()}<th>{m.staff_through()}</th>{/snippet}
				{#snippet cells(h)}<td class="cell-text">{h.sources.join(', ')}</td>{/snippet}
			</RosterTable>
		{/if}
		{#if data.committees.length > 0}
			<InfoCard
				title={m.staff_access_permission_holders_committees_granting()}
				state={data.committees.length}
			>
				<ul class="space-y-1">
					{#each data.committees as c (c.groupId)}
						<li class="flex items-center justify-between gap-2">
							<span class="font-medium">{c.name}</span>
							<CommitteeGrantsAction
								groupId={c.groupId}
								name={c.name}
								held={c.held}
								label={m.staff_edit_grants()}
								onsuccess={refresh}
							/>
						</li>
					{/each}
				</ul>
			</InfoCard>
		{/if}
		{#if data.roles.length > 0}
			<InfoCard
				title={m.staff_access_permission_holders_volunteer_roles_granting_per()}
				state={data.roles.length}
			>
				<p class="text-muted">
					{m.staff_access_permission_holders_held_only_by_confirmed_volun()}
				</p>
				<p>{data.roles.map((r) => r.name).join(', ')}</p>
			</InfoCard>
		{/if}
	{:else}
		{@const rows = data.clearances.filter(
			(c) =>
				matches(c) &&
				(!clearanceState || (clearanceState === 'lapsing' ? c.lapsing : c.state === clearanceState))
		)}
		{@render count(rows, `${rows.length} of ${data.clearances.length} on record`)}
		{#if rows.length === 0}
			<EmptyState
				title={m.staff_access_permission_holders_nobody()}
				description={m.staff_access_permission_holders_no_grant_clearance_matches()}
			/>
		{:else}
			<RosterTable {rows} personLabel={m.staff_access_permission_holders_person_label()}>
				{#snippet lead(c)}<StatusBadge status={c.state} />{/snippet}
				{#snippet columns()}
					<th class="col-support">{m.staff_access_permission_holders_granted()}</th>
					<th>{m.staff_expires()}</th>
				{/snippet}
				{#snippet cells(c)}
					<td class="col-support whitespace-nowrap">{formatDateShortYear(c.grantedAt)}</td>
					<td class="whitespace-nowrap">
						{c.expiresAt ? formatDateShortYear(c.expiresAt) : 'No expiry'}
					</td>
				{/snippet}
				{#snippet actions(c)}
					{#if c.state !== 'revoked'}
						<RevokeClearanceAction
							id={c.id}
							userId={c.userId}
							name={c.certificationName}
							onsuccess={refresh}
						/>
					{/if}
				{/snippet}
			</RosterTable>
		{/if}
	{/if}
{/if}
