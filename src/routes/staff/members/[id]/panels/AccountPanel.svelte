<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import {
		getUser,
		getRoleCatalog,
		getUserPage,
		getUserSessions,
		getUserHistory,
		deactivateUser,
		reactivateUser,
		purgeUser,
		banUser,
		unbanUser,
		suspendUser,
		liftSuspension,
		resendRemovalNotice,
		getUserRemovals
	} from '#lib/remote/users.remote.js';
	import { positionLabels, removalKindLabels, removalLiftReasonLabels } from '#lib/config.js';
	import { getUserDirectoryProfile } from '#lib/remote/directory.remote.js';
	import StaffUserForm from '../StaffUserForm.svelte';
	import EmailChangeCard from '../EmailChangeCard.svelte';
	import ViewAsMember from '../ViewAsMember.svelte';
	import { RelatedList } from '#lib/components/ui/entity/index.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		formatDateTimeShort,
		formatDateShortYear,
		formatHistoryTime
	} from '#lib/utils/format.js';
	import { ActivityFeedCard, feedItemRow } from '#lib/components/ui/ActivityFeed/index.js';
	import { toast } from 'svelte-sonner';
	import { Latest } from '#lib/latest.svelte.js';
	import WhyCanAct from '#lib/components/access/WhyCanAct.svelte';
	import { getPersonAccessWhy } from '#lib/remote/why-can-act.remote.js';

	let { id, member }: { id: string; member: Awaited<ReturnType<typeof getUser>> } = $props();

	const { fields: deactivateFields } = deactivateUser;
	const { fields: reactivateFields } = reactivateUser;
	const { fields: purgeFields } = purgeUser;
	const { fields: banFields } = banUser;
	const { fields: unbanFields } = unbanUser;
	const { fields: suspendFields } = suspendUser;
	const { fields: liftFields } = liftSuspension;
	const { fields: resendFields } = resendRemovalNotice;

	// Deactivating cancels bookings and the subscription, so the scoreboard and
	// the needs-attention list are both wrong until the overview is re-read.
	function refreshAccount() {
		// One refresh: the page reads both halves through `getUserPage`.
		void getUserPage(id).refresh();
		void getUserRemovals(id).refresh();
	}

	// Reactivation resumes a subscription cancelled at period end, but a period
	// that elapsed while the account was closed cannot be resumed at all. Staff
	// have to know which happened — the success toast says the same thing either
	// way, and a silently unsubscribed member is found weeks later.
	function onReactivated(result?: unknown) {
		refreshAccount();
		if ((result as { subscription?: string } | undefined)?.subscription === 'lapsed') {
			toast.warning(m.staff_members_id_panels_account_panel_toast());
		}
	}

	// Not `{#await}`: a refresh would re-pend it and remount the form mid-edit (#2356).
	const roleCatalog = new Latest(() => getRoleCatalog());
	$effect(() => {
		if (roleCatalog.error) throw roleCatalog.error.e;
	});

	// Why this person can act (#2994): positions, committee seats, shift roles.
	const why = new Latest(() => getPersonAccessWhy(id));
	$effect(() => {
		if (why.error) throw why.error.e;
	});
</script>

<!--
	getRoleCatalog is awaited here rather than in +page.svelte so the roles catalog
	is only fetched when someone actually opens this tab — the same reason every
	other panel owns its own queries. It also carries `canSetRole`, which hides
	the picker from a caller who may edit the profile but not the roles: without
	that they would submit a role set they cannot change and land on a 403.
-->
<ViewAsMember {id} />

{#if roleCatalog.current}
	{@const catalog = roleCatalog.current}
	{@const roleOptions = catalog.roles.map((r) => ({
		id: String(r.id),
		label: (positionLabels as Record<string, string>)[r.name] ?? r.name
	}))}
	{@const initialRoles = catalog.roles
		.filter((r) => member.roles.includes(r.name))
		.map((r) => String(r.id))}
	<StaffUserForm {member} {roleOptions} {initialRoles} {id} canSetRole={catalog.canSetRole} />
{/if}

{#if why.current}
	<WhyCanAct why={why.current} />
{/if}

<EmailChangeCard {id} email={member.email} />

<RelatedList
	title={m.staff_members_id_panels_account_panel_directory_profile_title()}
	result={getUserDirectoryProfile(id)}
>
	{#snippet children(data)}
		{#if !data.profile}
			<EmptyState
				title={m.staff_members_id_panels_account_panel_no_profile_title()}
				description={m.staff_members_id_panels_account_panel_account_has_no_directo_body()}
			/>
		{:else}
			<DefinitionList>
				<Fact
					label={m.staff_members_id_panels_account_panel_visibility_label()}
					class="flex items-center gap-2"
				>
					<Badge
						size="sm"
						variant={data.profile.directoryVisibility === 'hidden' ? 'ghost' : 'info'}
					>
						{data.profile.directoryVisibility}
					</Badge>
					{#if !data.complete}
						<span class="opacity-60"
							>{m.staff_members_id_panels_account_panel_profile_incomplete_text()}</span
						>
					{/if}
				</Fact>

				<Fact label={m.staff_members_id_panels_account_panel_tagline_label()}
					>{data.profile.tagline || '—'}</Fact
				>

				<Fact label={m.staff_members_id_panels_account_panel_hometown_label()}
					>{data.profile.hometown || '—'}</Fact
				>

				<Fact
					label={m.staff_members_id_panels_account_panel_instruments_label()}
					class="flex flex-wrap gap-1"
				>
					{#each data.profile.instruments as i (i)}
						<Badge size="sm">{i}</Badge>
					{:else}
						—
					{/each}
				</Fact>

				<Fact
					label={m.staff_members_id_panels_account_panel_genres_label()}
					class="flex flex-wrap gap-1"
				>
					{#each data.profile.genres as g (g)}
						<Badge size="sm">{g}</Badge>
					{:else}
						—
					{/each}
				</Fact>

				<Fact
					label={m.staff_members_id_panels_account_panel_open_label()}
					class="flex flex-wrap gap-1"
				>
					{#if data.profile.lookingForBand}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_looking_band_label()}</Badge
						>{/if}
					{#if data.profile.availableForHire}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_hire_label()}</Badge
						>{/if}
					{#if data.profile.teachesLessons}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_teaches_privately_label()}</Badge
						>{/if}
					{#if data.profile.openToCollaboration}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_collaboration_label()}</Badge
						>{/if}
					{#if !data.profile.lookingForBand && !data.profile.availableForHire && !data.profile.teachesLessons && !data.profile.openToCollaboration}
						—
					{/if}
				</Fact>
			</DefinitionList>
			<div class="mt-3">
				<Button href={resolve(`member/directory/members/${id}`)} variant="ghost" size="sm">
					{m.staff_members_id_panels_account_panel_view_public_profile_label()}
				</Button>
			</div>
		{/if}
	{/snippet}
</RelatedList>

<!--
	Read-only. Revoking a session would be a new mutation, and the one lever staff
	already have for cutting off access — deactivation — deletes them all.
-->
<RelatedList
	title={m.staff_members_id_panels_account_panel_sign_activity_title()}
	result={getUserSessions(id)}
>
	{#snippet children(data)}
		<p class="mb-3 text-muted">
			{m.staff_members_id_panels_account_panel_last_sign_text({
				value: data.lastLoginAt
					? formatDateTimeShort(data.lastLoginAt)
					: m.staff_members_id_panels_account_panel_never_record_text()
			})}
		</p>
		{#if data.sessions.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_account_panel_no_active_sessions_title()}
				description={m.staff_members_id_panels_account_panel_they_signed_out_everyw_body()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_started_label()}</th>
					<th class="col-support">{m.staff_members_id_panels_account_panel_ip_label()}</th>
					<th class="col-extra">{m.staff_expires_label()}</th>
				{/snippet}
				{#each data.sessions as s (s.id)}
					<tr class="hover">
						<td class="cell-primary">
							<div class="font-medium whitespace-nowrap">{formatDateTimeShort(s.createdAt)}</div>
							<div class="truncate text-muted">
								{s.userAgent ?? m.staff_members_id_panels_account_panel_unknown_device_text()}
							</div>
						</td>
						<td class="col-support font-mono text-xs">{s.ipAddress ?? '—'}</td>
						<td class="col-extra whitespace-nowrap">{formatDateShortYear(s.expiresAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<!-- Staff changes to this account, newest first. Reads only; nothing here edits the log. -->
<ActivityFeedCard
	title={m.staff_history_title()}
	query={(limit) => getUserHistory(limit ? { userId: id, limit } : { userId: id })}
	toRow={feedItemRow}
	empty={{
		title: m.staff_no_recorded_changes_title(),
		description: m.staff_members_id_panels_account_panel_role_profile_credit_ac_body()
	}}
/>

<!-- Each row is one removal; it rests on the report linked beside it. -->
<RelatedList
	title={m.staff_members_id_panels_account_panel_removals_title()}
	result={getUserRemovals(id)}
>
	{#snippet children(rows)}
		{#if rows.length === 0}
			<EmptyState title={m.staff_members_id_panels_account_panel_no_removals_title()} />
		{:else}
			<Table>
				{#snippet head()}
					<th class="cell-primary">{m.staff_reason_label()}</th>
					<th class="col-support">{m.staff_status_label()}</th>
					<th class="col-extra">{m.staff_members_id_panels_account_panel_removal_report_label()}</th
					>
				{/snippet}
				{#each rows as r (r.id)}
					<tr>
						<td class="cell-primary">
							<div class="flex items-center gap-2 font-medium">
								<Badge size="sm" variant={r.kind === 'ban' ? 'error' : 'warning'}
									>{removalKindLabels[r.kind]}</Badge
								>
								{m.staff_members_id_panels_account_panel_removal_by_text({
									date: formatDateShortYear(r.createdAt),
									name:
										r.actorName ?? m.staff_members_id_panels_account_panel_removed_account_text()
								})}
							</div>
							<div class="text-muted whitespace-pre-line">{r.reason}</div>
						</td>
						<td class="col-support">
							{#if r.liftedAt}
								{m.staff_members_id_panels_account_panel_removal_lifted_text({
									reason: r.liftReason ? removalLiftReasonLabels[r.liftReason] : '—',
									date: formatDateShortYear(r.liftedAt)
								})}
							{:else if r.endsAt}
								{m.staff_members_id_panels_account_panel_removal_ends_text({
									date: formatDateShortYear(r.endsAt)
								})}
							{:else}
								{m.staff_members_id_panels_account_panel_removal_open_text()}
							{/if}
						</td>
						<td class="col-extra">
							<a class="link" href={resolve(`staff/flags/${r.flagId}`)}
								>{m.staff_members_id_panels_account_panel_removal_report_text()}</a
							>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<InfoCard title={m.staff_details_title()} class="bg-base-200 shadow-none">
	<DefinitionList>
		<Fact label={m.staff_members_id_panels_account_panel_user_id_label()} mono>{member.id}</Fact>

		<Fact label={m.staff_members_id_panels_account_panel_member_no_label()}
			>{member.memberNumber ?? '—'}</Fact
		>

		<!-- Nothing is gated on this, so "not confirmed" is not a restriction and
		     should not read like one. Every account predating #757 shows it. -->
		<Fact label={m.staff_members_id_panels_account_panel_email_confirmed_label()}>
			{#if member.emailVerified}
				{m.staff_yes_text()}
			{:else}
				<span class="text-muted"
					>{m.staff_members_id_panels_account_panel_not_yet_full_access_ei_text()}</span
				>
			{/if}
		</Fact>

		<Fact label={m.staff_members_id_panels_account_panel_stripe_id_label()} mono
			>{member.stripeId ?? '—'}</Fact
		>

		<Fact label={m.staff_joined_label()}>{formatHistoryTime(new Date(member.createdAt))}</Fact>

		{#if member.deletedAt}
			<Fact label={m.staff_deactivated_label()}
				>{formatHistoryTime(new Date(member.deletedAt))}</Fact
			>
		{/if}

		{#if member.bannedAt}
			<Fact label={m.staff_members_id_panels_account_panel_banned_label()}>
				{m.staff_members_id_panels_account_panel_by_text({
					formatHistoryTime: formatHistoryTime(new Date(member.bannedAt)),
					bannedByName:
						member.bannedByName ?? m.staff_members_id_panels_account_panel_removed_account_text()
				})}
			</Fact>
			<Fact
				label={m.staff_members_id_panels_account_panel_ban_reason_label()}
				class="whitespace-pre-line">{member.banReason}</Fact
			>
		{/if}
	</DefinitionList>
</InfoCard>

{#snippet banAction()}
	<Action
		action={banUser}
		label={m.staff_members_id_panels_account_panel_ban_label()}
		modalTitle={m.staff_members_id_panels_account_panel_modal_title({ name: member.name })}
		submitLabel={m.staff_members_id_panels_account_panel_ban_label()}
		successToast={m.staff_members_id_panels_account_panel_member_banned_toast()}
		variant="error"
		size="sm"
		onsuccess={refreshAccount}
	>
		{#snippet form()}
			<input {...banFields.id.as('hidden', id)} />
			<p class="pb-4">
				{m.staff_members_id_panels_account_panel_ban_deactivates_accoun_text()}
			</p>
			<FormField
				field={banFields.reason}
				type="textarea"
				label={m.staff_reason_label()}
				description={m.staff_members_id_panels_account_panel_staff_only_what_they_d_body()}
				required
			/>
		{/snippet}
	</Action>
{/snippet}

{#snippet resendAction()}
	<Action
		action={resendRemovalNotice}
		label={m.staff_members_id_panels_account_panel_resend_notice_label()}
		submitLabel={m.staff_members_id_panels_account_panel_resend_notice_label()}
		successToast={m.staff_members_id_panels_account_panel_notice_sent_toast()}
		variant="ghost"
		size="sm"
	>
		{#snippet form()}
			<input {...resendFields.id.as('hidden', id)} />
			<p class="py-4">{m.staff_members_id_panels_account_panel_resend_notice_text()}</p>
		{/snippet}
	</Action>
{/snippet}

{#snippet suspendAction()}
	<Action
		action={suspendUser}
		label={m.staff_members_id_panels_account_panel_suspend_label()}
		modalTitle={m.staff_members_id_panels_account_panel_suspend_title({ name: member.name })}
		submitLabel={m.staff_members_id_panels_account_panel_suspend_label()}
		successToast={m.staff_members_id_panels_account_panel_member_suspended_toast()}
		variant="warning"
		size="sm"
		onsuccess={refreshAccount}
	>
		{#snippet form()}
			<input {...suspendFields.id.as('hidden', id)} />
			<p class="pb-4">{m.staff_members_id_panels_account_panel_suspend_effects_text()}</p>
			<FormField
				field={suspendFields.days}
				type="number"
				label={m.staff_members_id_panels_account_panel_suspend_days_label()}
				value={member.suspensionDefaultDays}
				min={1}
				required
			/>
			<FormField
				field={suspendFields.reason}
				type="textarea"
				label={m.staff_reason_label()}
				description={m.staff_members_id_panels_account_panel_staff_only_what_they_d_body()}
				required
			/>
		{/snippet}
	</Action>
{/snippet}

<InfoCard
	title={m.staff_members_id_panels_account_panel_danger_zone_title()}
	class="mt-6 border border-error/30 bg-error/5 shadow-none"
>
	{#if member.suspendedUntil}
		<p class="mb-3 text-muted">
			{m.staff_members_id_panels_account_panel_suspended_until_text({
				date: formatDateShortYear(new Date(member.suspendedUntil))
			})}
		</p>
		<div class="flex gap-2">
			<Action
				action={liftSuspension}
				label={m.staff_members_id_panels_account_panel_lift_suspension_label()}
				successToast={m.staff_members_id_panels_account_panel_suspension_lifted_toast()}
				variant="success"
				size="sm"
				onsuccess={onReactivated}
			>
				{#snippet form()}
					<input {...liftFields.id.as('hidden', id)} />
					<p class="py-4">
						{m.staff_members_id_panels_account_panel_lift_suspension_text({ name: member.name })}
					</p>
				{/snippet}
			</Action>
			{@render resendAction()}
		</div>
	{:else if member.bannedAt}
		<p class="mb-3 text-muted">
			{m.staff_members_id_panels_account_panel_account_banned_lifting_text()}
		</p>
		<div class="flex gap-2">
			<Action
				action={unbanUser}
				label={m.staff_members_id_panels_account_panel_lift_ban_label()}
				successToast={m.staff_members_id_panels_account_panel_ban_lifted_toast()}
				variant="success"
				size="sm"
				onsuccess={onReactivated}
			>
				{#snippet form()}
					<input {...unbanFields.id.as('hidden', id)} />
					<p class="py-4">
						<ParaglideMessage
							message={m.staff_members_id_panels_account_panel_lift_ban_restore_their_text}
							inputs={{ name: member.name }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</p>
				{/snippet}
			</Action>
			{#if member.hasOpenRemoval}{@render resendAction()}{/if}
		</div>
	{:else if member.deletedAt}
		<p class="mb-3 text-muted">
			{m.staff_members_id_panels_account_panel_account_deactivated_re_text()}
		</p>
		<div class="flex gap-2">
			<Action
				action={reactivateUser}
				label={m.staff_members_id_panels_account_panel_reactivate_label()}
				successToast={m.staff_members_id_panels_account_panel_account_reactivated_toast()}
				variant="success"
				size="sm"
				onsuccess={onReactivated}
			>
				{#snippet form()}
					<input {...reactivateFields.id.as('hidden', id)} />
					<p class="py-4">{m.staff_members_id_panels_account_panel_reactivate_account_text()}</p>
				{/snippet}
			</Action>
			<Action
				action={purgeUser}
				label={m.staff_members_id_panels_account_panel_delete_permanently_label()}
				successToast={m.staff_members_id_panels_account_panel_account_deleted_toast()}
				variant="error"
				size="sm"
				onsuccess={() => goto(resolve('staff/members'))}
			>
				{#snippet form()}
					<input {...purgeFields.id.as('hidden', id)} />
					<p class="py-4">
						<ParaglideMessage
							message={m.staff_members_id_panels_account_panel_permanently_delete_can_text}
							inputs={{ name: member.name }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</p>
				{/snippet}
			</Action>
			{@render banAction()}
		</div>
	{:else}
		<p class="mb-3 text-muted">
			<ParaglideMessage
				message={m.staff_members_id_panels_account_panel_deactivating_signs_mem_text}
				inputs={{
					staff_members_id_panels_account_panel_cancelled_reservations:
						m.staff_members_id_panels_account_panel_cancelled_reservations_text()
				}}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>
		<div class="flex gap-2">
			<Action
				action={deactivateUser}
				label={m.staff_deactivate_label()}
				successToast={m.staff_members_id_panels_account_panel_account_deactivated_toast()}
				variant="error"
				size="sm"
				onsuccess={refreshAccount}
			>
				{#snippet form()}
					<input {...deactivateFields.id.as('hidden', id)} />
					<p class="py-4">
						{m.staff_members_id_panels_account_panel_deactivate_account_all_text()}
					</p>
				{/snippet}
			</Action>
			{@render suspendAction()}
			{@render banAction()}
		</div>
	{/if}
</InfoCard>
