<script lang="ts">
	import { resolve } from '$app/paths';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import CommitteeGrantsAction from '$lib/components/groups/CommitteeGrantsAction.svelte';
	import GrantCertificationAction from '../members/[id]/panels/GrantCertificationAction.svelte';
	import RevokeClearanceAction from './RevokeClearanceAction.svelte';
	import {
		getAccessPage,
		getPersonAccessView,
		searchAccessPeople,
		setPosition
	} from '$lib/remote/access.remote';
	import {
		grantRuleFor,
		grantsCapability,
		positionLabels,
		positionOrder,
		positions as matrix
	} from '$lib/config';
	import { formatDateShortYear } from '$lib/utils/format';
	import { actionLabel, groupByResource } from './capability-label';

	type Person = { id: string; name: string; email: string };
	let { person = $bindable(null) }: { person?: Person | null } = $props();

	function refresh() {
		if (person) void getPersonAccessView(person.id).refresh();
		void getAccessPage().refresh();
	}
</script>

<FilterBar activeCount={person ? 1 : 0} onclear={() => (person = null)}>
	{#snippet search()}
		<SearchSelect search={searchAccessPeople} bind:value={person} placeholder="Find a person..." />
	{/snippet}
</FilterBar>

{#if !person}
	<EmptyState
		title="Pick a person"
		description="Search by name or email to see every position, committee seat and clearance they hold."
	/>
{:else}
	{@const userId = person.id}
	{#await getPersonAccessView(userId) then access}
		{@const unheld = positionOrder.filter((p) => !access.positions.includes(p))}
		{@const orgSeats = access.seats.flatMap((s) =>
			s.grants
				.filter((c) => grantRuleFor(c)?.committee === 'org')
				.map((cap) => ({ cap, from: s.name }))
		)}
		{@const held = [...new Set([...access.capabilities, ...orgSeats.map((o) => o.cap)])]}

		<InfoCard title="Positions" state={access.positions.length}>
			{#snippet header(title)}
				<div class="flex items-center justify-between gap-2">
					<CardTitle>{title}</CardTitle>
					{#if unheld.length > 0}
						<Action
							action={setPosition.for(`add-${userId}`)}
							label="Assign position"
							size="sm"
							modalTitle="Assign a position to {person?.name}"
							submitLabel="Assign"
							successToast="Position assigned"
							onsuccess={refresh}
						>
							{#snippet form()}
								<input type="hidden" name="userId" value={userId} />
								<input type="hidden" name="change" value="add" />
								<FormField
									name="position"
									label="Position"
									type="select"
									options={unheld.map((p) => ({ value: p, label: positionLabels[p] }))}
								/>
							{/snippet}
						</Action>
					{/if}
				</div>
			{/snippet}
			{#if access.positions.length === 0}
				<p class="text-muted">No position. They hold only what a member holds.</p>
			{:else}
				<Table>
					{#snippet head()}
						<th>Position</th>
						<th class="col-support cell-num">Capabilities</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}
					{#each access.positions as p (p)}
						<tr>
							<td class="cell-primary">{positionLabels[p]}</td>
							<td class="col-support cell-num">
								{access.capabilities.filter((c) => grantsCapability(matrix[p], c)).length}
							</td>
							<td class="w-px">
								<Action
									action={setPosition.for(`remove-${userId}-${p}`)}
									label="Remove"
									variant="ghost"
									size="xs"
									class="text-error"
									modalTitle="Remove {positionLabels[p]} from {person?.name}?"
									submitLabel="Remove"
									submitVariant="error"
									successToast="Position removed"
									onsuccess={refresh}
								>
									{#snippet form()}
										<input type="hidden" name="userId" value={userId} />
										<input type="hidden" name="position" value={p} />
										<input type="hidden" name="change" value="remove" />
										<p class="text-sm">
											Takes effect on their next request. The change is recorded in the audit log.
										</p>
									{/snippet}
								</Action>
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>

		<InfoCard title="Capabilities" state={held.length}>
			{#if held.length === 0}
				<p class="text-muted">Nothing beyond a member's own pages.</p>
			{:else}
				<Table>
					{#snippet head()}
						<th>Area</th>
						<th>May</th>
						<th class="col-support">Through</th>
					{/snippet}
					{#each groupByResource(held) as g (g.resource)}
						{@const from = [
							...access.positions
								.filter((p) => g.caps.some((c) => grantsCapability(matrix[p], c)))
								.map((p) => positionLabels[p]),
							...new Set(orgSeats.filter((o) => g.caps.includes(o.cap)).map((o) => o.from))
						]}
						<tr>
							<td class="font-medium whitespace-nowrap">{g.label}</td>
							<td class="cell-primary">
								<div class="whitespace-normal">{g.caps.map(actionLabel).join(', ')}</div>
							</td>
							<td class="col-support cell-text">{from.join(', ')}</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>

		<InfoCard title="Committee seats" state={access.seats.length}>
			{#if access.seats.length === 0}
				<p class="text-muted">No active committee seat.</p>
			{:else}
				<Table>
					{#snippet head()}
						<th>Committee</th>
						<th>Grants its members</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}
					{#each access.seats as seat (seat.groupId)}
						<tr>
							<td class="cell-primary">
								<a
									class="font-medium link-hover"
									href={resolve('/staff/groups/[id]', { id: seat.groupId })}>{seat.name}</a
								>
								<div class="text-muted">{seat.chair ? 'Chair' : 'Member'}</div>
							</td>
							<td class="cell-text whitespace-normal">
								{#if seat.grants.length === 0}
									<span class="text-muted">Nothing beyond the seat</span>
								{:else}
									{seat.grants
										.map(
											(c) =>
												`${grantRuleFor(c)?.label ?? c}${grantRuleFor(c)?.committee === 'owned' ? ' (its records)' : ''}`
										)
										.join('; ')}
								{/if}
							</td>
							<td class="w-px">
								<CommitteeGrantsAction
									groupId={seat.groupId}
									name={seat.name}
									held={seat.grants}
									label="Edit grants"
									onsuccess={refresh}
								/>
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>

		<InfoCard title="Clearances" state={access.clearances.length}>
			{#snippet header(title)}
				<div class="flex items-center justify-between gap-2">
					<CardTitle>{title}</CardTitle>
					<GrantCertificationAction {userId} onsuccess={refresh} />
				</div>
			{/snippet}
			{#if access.clearances.length === 0}
				<p class="text-muted">No clearance on record.</p>
			{:else}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Clearance</th>
						<th class="col-support">Expires</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}
					{#each access.clearances as c (c.id)}
						<tr>
							<td class="w-px"><StatusBadge status={c.state} /></td>
							<td class="cell-primary">
								<div class="truncate font-medium">{c.certificationName}</div>
								<div class="truncate text-muted">
									Granted {formatDateShortYear(c.grantedAt)}{c.grantedByName
										? ` by ${c.grantedByName}`
										: ''}{c.revokedReason ? ` · revoked: ${c.revokedReason}` : ''}
								</div>
							</td>
							<td class="col-support whitespace-nowrap">
								{c.expiresAt ? formatDateShortYear(c.expiresAt) : 'No expiry'}
							</td>
							<td class="w-px">
								{#if !c.revokedAt}
									<RevokeClearanceAction
										id={c.id}
										{userId}
										name={c.certificationName}
										onsuccess={refresh}
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	{/await}
{/if}
