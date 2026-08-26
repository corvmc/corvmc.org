<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Button from '$lib/components/ui/Button.svelte';
	import { toast } from 'svelte-sonner';
	import { formatDateShort } from '$lib/utils/format';
	import { getInterestedVolunteers } from '$lib/remote/volunteer.remote';

	/**
	 * The members who said they would help with this role, owning the query behind them.
	 *
	 * Paginated, so it is keyed by a page number the page's role-id-keyed query cannot carry — see
	 * RoleShiftsCard for the same reasoning.
	 */
	let { role }: { role: { id: string; name: string } } = $props();

	// Until there's an in-app way to mail volunteers, the useful move is to hand staff the
	// addresses for whatever they're looking at. Copies the page in view, and says so, rather
	// than implying it grabbed everyone.
	async function copyEmails(emails: string[]) {
		try {
			await navigator.clipboard.writeText(emails.join(', '));
			toast.success(`Copied ${emails.length} ${emails.length === 1 ? 'address' : 'addresses'}`);
		} catch {
			toast.error("Couldn't copy — your browser blocked clipboard access");
		}
	}

	let pageNumber = $state(1);

	const interested = $derived(
		getInterestedVolunteers({ volunteerRoleId: role.id, page: pageNumber })
	);
</script>

<InfoCard title="Interested Members">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			{#await interested then r}
				<CardTitle>
					{title}
					<!-- The count that matters when the role is gated is how many could
					     actually take a shift, not how many said yes. -->
					{#if r.gated && r.rows.length > 0}
						<span class="text-muted font-normal">
							· {r.rows.filter((m) => m.missing.length === 0).length} of {r.rows.length} ready
						</span>
					{/if}
				</CardTitle>
			{/await}
			{#await interested then r}
				{#if r.rows.length > 0}
					<Button variant="ghost" size="sm" onclick={() => copyEmails(r.rows.map((m) => m.email))}>
						Copy emails on this page
					</Button>
				{/if}
			{/await}
		</div>
	{/snippet}

	{#await interested then r}
		{@const gated = r.gated}
		<DataList
			result={interested}
			empty="No one has picked this role yet."
			onpage={(p) => (pageNumber = p)}
		>
			{#snippet children(members)}
				<Table>
					{#snippet head()}
						{#if gated}
							<th class="w-px"><span class="sr-only">Cleared</span></th>
						{/if}
						<th>Member</th>
						<th class="col-support">Also interested in</th>
						<th class="col-extra whitespace-nowrap">Since</th>
					{/snippet}

					{#each members as member (member.userId)}
						{@const alsoIn = member.roleNames.filter((n) => n !== role.name)}
						<tr class="hover">
							{#if gated}
								<td class="w-px">
									<StatusBadge status={member.missing.length === 0 ? 'cleared' : 'uncleared'} />
								</td>
							{/if}
							<td class="cell-primary whitespace-nowrap">
								<EntityIdentity ref={member.member} />
								{#if gated && member.missing.length > 0}
									<div class="text-xs text-warning">
										needs {member.missing.map((c) => c.name).join(', ')}
									</div>
								{/if}
							</td>

							<td class="col-support">
								{#if alsoIn.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each alsoIn as roleName (roleName)}
											<span class="badge badge-ghost badge-sm">{roleName}</span>
										{/each}
									</div>
								{/if}
							</td>

							<td class="col-extra whitespace-nowrap">{formatDateShort(member.since)}</td>
						</tr>
					{/each}
				</Table>
			{/snippet}
		</DataList>
	{/await}
</InfoCard>
