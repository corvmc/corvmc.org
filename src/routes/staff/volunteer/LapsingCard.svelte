<script lang="ts">
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
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
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

	let { rows }: { rows: Row[] } = $props();
</script>

<InfoCard title="Lapses before a shift they're on">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<Button href="/staff/volunteer/people?tab=cleared" variant="ghost" size="sm">
				Who's cleared →
			</Button>
		</div>
	{/snippet}

	<Table>
		{#snippet head()}
			<th>Member</th>
			<th class="col-support">Clearance</th>
			<th class="col-support whitespace-nowrap">Expires</th>
			<th class="whitespace-nowrap">Shift</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
		{/snippet}

		{#each rows as row (row.userId + row.certificationId + row.shiftId)}
			<tr class="hover">
				<td class="cell-primary">
					<!-- Straight to the member's page, because granting a renewal is the fix
					     and Grant Certification already lives there. -->
					<a href="{resolve(`/staff/users/${row.userId}`)}?tab=volunteer" class="link">
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
						label="Renew"
						variant="ghost"
						size="xs"
						modalTitle="Renew {row.certificationName} for {row.member.title}?"
						submitLabel="Grant"
						successToast="Renewed. That shift is covered."
					>
						{#snippet form()}
							<input type="hidden" name="userId" value={row.userId} />
							<input type="hidden" name="certificationId" value={row.certificationId} />
							<FormField
								name="grantedOn"
								label="Granted on"
								type="date"
								value={clubToday()}
								description="Expiry is stamped from this date and locked in. Grants append, so this is a new row rather than an edit to the old one."
							/>
							<FormField
								name="reference"
								label="Reference"
								type="text"
								maxlength={CERT_REFERENCE_MAX}
								description="Card or certificate number, if there is one."
							/>
							<p class="text-sm">
								Their current one expires {formatDateShortYear(row.expiresAt)}, before
								{row.roleName} on {formatDateShort(row.startsAt)}. Granting this clears them for it.
							</p>
						{/snippet}
					</Action>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>
