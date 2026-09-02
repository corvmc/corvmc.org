<script lang="ts">
	/**
	 * Who holds what, and until when. One row per person and clearance — grants
	 * append, so a renewal is a new row and the newest one wins.
	 *
	 * Owns its query and mounts only when its tab is open; see SignoffTab for
	 * why the page cannot declare all three side by side.
	 */
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import CertificationOptions from '$lib/components/volunteer/CertificationOptions.svelte';
	import { formatDateShort, formatDateShortYear } from '$lib/utils/format';
	import { CERT_EXPIRY_WARNING_DAYS, CERT_REVOKED_REASON_MAX } from '$lib/config';
	import { getClearancesPage, revokeCertification } from '$lib/remote/volunteer.remote';

	let { certFilter = $bindable('') }: { certFilter?: string } = $props();

	const cleared = $derived(
		getClearancesPage({ certificationId: certFilter || undefined, state: undefined })
	);

	const badgeClass: Record<string, string> = {
		current: 'badge-success',
		expiring: 'badge-warning',
		expired: 'badge-error',
		revoked: 'badge-neutral'
	};
</script>

<FilterBar activeCount={certFilter ? 1 : 0} onclear={() => (certFilter = '')}>
	<Select
		size="sm"
		aria-label="Certification"
		value={certFilter}
		onchange={(e: Event) => {
			certFilter = (e.currentTarget as HTMLSelectElement).value;
		}}
	>
		<option value="">All clearances</option>
		<CertificationOptions />
	</Select>
</FilterBar>

{#await cleared then result}
	{#if result.rows.length === 0}
		<EmptyState title="Nobody here" description="No grants match this view." />
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">State</span></th>
				<th>Member</th>
				<th class="col-support">Clearance</th>
				<th class="col-extra whitespace-nowrap">Granted</th>
				<th class="w-px"><span class="sr-only">Actions</span></th>
			{/snippet}

			{#each result.rows as row (row.id)}
				<tr class="hover">
					<td class="w-px">
						<!-- Says the date whenever there is one, and keeps its tone from the
						     state: "expiring" without a date makes staff open the row to learn
						     the only thing the chip was for. -->
						<span class="badge badge-sm {badgeClass[row.state]}">
							{row.state === 'revoked'
								? 'revoked'
								: row.expiresAt
									? `expires ${formatDateShort(row.expiresAt)}`
									: 'current'}
						</span>
					</td>
					<td class="whitespace-nowrap">
						<EntityIdentity ref={row.member} />
					</td>
					<td class="col-support cell-primary">{row.certificationName}</td>
					<td class="col-extra whitespace-nowrap">{formatDateShortYear(row.grantedAt)}</td>
					<td class="w-px">
						{#if row.state !== 'revoked'}
							<Action
								action={revokeCertification.for(row.id)}
								label="Revoke"
								variant="ghost"
								size="xs"
								class="text-error"
								modalTitle="Revoke {row.certificationName}?"
								submitLabel="Revoke"
								submitVariant="error"
								successToast="Revoked"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={row.id} />
									<input type="hidden" name="userId" value={row.userId} />
									<FormField
										name="reason"
										label="Why"
										type="textarea"
										description="Kept on the record. Revoking does not erase the period it covered — that is the point of it."
										maxlength={CERT_REVOKED_REASON_MAX}
									/>
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		<p class="text-subtle text-xs">
			One row per person and clearance, newest grant first. Grants are made on a person's record; a
			renewal is a new row, never an edit. Expiring means inside {CERT_EXPIRY_WARNING_DAYS} days.
		</p>
	{/if}
{/await}
