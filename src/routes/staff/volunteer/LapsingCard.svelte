<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * Clearances that run out before a shift the holder is already on.
	 *
	 * Not the same list as `/staff/volunteer/clearances?state=expiring`, and the difference
	 * is the point (docs/reports/volunteer-workflow-findings.md#c1). That page answers "who
	 * expires soon", which nobody is obliged to act on. This one has a deadline attached:
	 * somebody is rostered for Saturday, the card their role requires lapses on Friday, and
	 * the gate — checked as of the shift's date — will be right to refuse them while the
	 * roster still says they are booked.
	 *
	 * Waiting on a member rather than on staff, which is why it sits below everything else.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { resolve } from '$app/paths';
	import { formatDateShort, formatDateShortYear } from '$lib/utils/format';
	import { clubToday, CERT_REFERENCE_MAX } from '$lib/config';
	import { grantCertification } from '$lib/remote/volunteer.remote';
	import type { MemberRef } from '$lib/types/entity';

	type Row = {
		userId: string;
		member: MemberRef;
		certificationId: string;
		certificationName: string;
		expiresAt: Date;
		shiftId: string;
		roleName: string;
		startsAt: Date;
	};

	let { rows, total }: { rows: Row[]; total: number } = $props();
</script>

<InfoCard title={m.staff_volunteer_lapsing_card_title()} state={total}>
	{#snippet action()}
		<Button href="/staff/members/volunteers" variant="ghost" size="sm"
			>{m.staff_volunteer_lapsing_card_who_s_cleared()}</Button
		>
	{/snippet}

	<Table>
		{#snippet head()}
			<th>{m.staff_member()}</th>
			<th class="col-support">{m.staff_clearance()}</th>
			<th class="col-support whitespace-nowrap">{m.staff_expires()}</th>
			<th class="whitespace-nowrap">{m.staff_shift()}</th>
			<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
		{/snippet}

		{#each rows as row (row.userId + row.certificationId + row.shiftId)}
			<tr class="hover">
				<td class="cell-primary">
					<!-- Straight to the member's page, because granting a renewal is the fix
					     and Grant Certification already lives there. -->
					<a href="{resolve(`/staff/members/${row.userId}`)}?tab=volunteer" class="link">
						<EntityIdentity ref={row.member} />
					</a>
				</td>
				<td class="col-support">{row.certificationName}</td>
				<td class="col-support whitespace-nowrap text-warning">
					{formatDateShortYear(row.expiresAt)}
				</td>
				<td class="whitespace-nowrap">
					<a href={resolve(`/staff/volunteer/shifts/${row.shiftId}`)} class="link">
						{row.roleName}, {formatDateShort(row.startsAt)}
					</a>
				</td>
				<td class="w-px">
					<!--
						The fix, on the row that names the problem. Not
						`GrantCertificationAction`: that loads the whole catalogue to
						populate a picker, and this row already knows which clearance and
						whose — a query per row to re-ask a question the row answers.
					-->
					<Action
						action={grantCertification.for(`${row.userId}:${row.certificationId}`)}
						label={m.staff_volunteer_lapsing_card_renew()}
						variant="ghost"
						size="xs"
						modalTitle={m.staff_volunteer_lapsing_card_modal_title({
							certificationName: row.certificationName,
							title: row.member.title
						})}
						submitLabel={m.staff_volunteer_lapsing_card_renew()}
						successToast={m.staff_volunteer_lapsing_card_success_toast()}
					>
						{#snippet form()}
							<input type="hidden" name="userId" value={row.userId} />
							<input type="hidden" name="certificationId" value={row.certificationId} />
							<FormField
								name="grantedOn"
								label={m.staff_granted()}
								type="date"
								value={clubToday()}
								description={m.staff_volunteer_lapsing_card_expiry_stamped_from_date_locked()}
							/>
							<FormField
								name="reference"
								label={m.staff_reference()}
								type="text"
								maxlength={CERT_REFERENCE_MAX}
								description={m.staff_volunteer_lapsing_card_card_certificate_number_if_ther()}
							/>
							<p class="text-sm">
								{m.staff_volunteer_lapsing_card_their_current_one_expires_befor({
									formatDateShortYear: formatDateShortYear(row.expiresAt),
									roleName: row.roleName,
									formatDateShort: formatDateShort(row.startsAt)
								})}
							</p>
						{/snippet}
					</Action>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>
