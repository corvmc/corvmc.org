<script lang="ts">
	/**
	 * Under-18 sign-ups waiting on a guardian.
	 *
	 * Owns its query and mounts only when its tab is open, which is what keeps
	 * the page to one load-bearing query — three of them declared side by side
	 * is a fan-out the custom lint rule refuses, and past kit 2.64 it renders as
	 * `effect_update_depth_exceeded` rather than as three fetches.
	 */
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { formatDateShortYear } from '$lib/utils/format';
	import { getBlockedVolunteers, approveVolunteerSignup } from '$lib/remote/volunteer.remote';

	const minors = $derived(getBlockedVolunteers());
</script>

{#await minors then rows}
	{#if rows.length === 0}
		<EmptyState
			title="Nobody waiting"
			description="Under-18 sign-ups land here until a guardian has signed off."
		/>
	{:else}
		<p class="text-subtle text-sm">
			Under 18. Can't claim shifts or log hours until a guardian signs off.
		</p>
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Minor</span></th>
				<th>Volunteer</th>
				<th class="col-support whitespace-nowrap">Signed up</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
			{/snippet}

			{#each rows as minor (minor.userId)}
				<tr class="hover">
					<td class="w-px"><Badge variant="warning" size="xs">MINOR</Badge></td>
					<td class="cell-primary">
						<EntityIdentity ref={minor.member} avatar />
					</td>
					<td class="col-support whitespace-nowrap">{formatDateShortYear(minor.createdAt)}</td>
					<td class="w-px">
						<Action
							action={approveVolunteerSignup.for(minor.userId)}
							label="Approve"
							variant="ghost"
							size="xs"
							class="text-success"
							modalTitle="Let {minor.member.title} volunteer?"
							submitLabel="Approve"
							successToast="{minor.member.title} can volunteer now"
						>
							{#snippet form()}
								<input type="hidden" name="userId" value={minor.userId} />
								<p class="text-sm">
									Confirms a guardian has signed off. They can claim shifts and log hours from then
									on, and their record still says they are under 18 — which is what changes how a
									shift is staffed.
								</p>
							{/snippet}
						</Action>
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
{/await}
