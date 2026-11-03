<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
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
		unbanUser
	} from '$lib/remote/users.remote';
	import { getUserDirectoryProfile } from '$lib/remote/directory.remote';
	import StaffUserForm from '../StaffUserForm.svelte';
	import EmailChangeCard from '../EmailChangeCard.svelte';
	import { RelatedList } from '$lib/components/ui/entity';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatDateTimeShort, formatDateShortYear, formatHistoryTime } from '$lib/utils/format';
	import { ActivityFeedCard, feedItemRow } from '$lib/components/ui/ActivityFeed';
	import { toast } from 'svelte-sonner';
	import { Latest } from '$lib/latest.svelte';

	let { id, member }: { id: string; member: Awaited<ReturnType<typeof getUser>> } = $props();

	const { fields: deactivateFields } = deactivateUser;
	const { fields: reactivateFields } = reactivateUser;
	const { fields: purgeFields } = purgeUser;
	const { fields: banFields } = banUser;
	const { fields: unbanFields } = unbanUser;

	// Deactivating cancels bookings and the subscription, so the scoreboard and
	// the needs-attention list are both wrong until the overview is re-read.
	function refreshAccount() {
		// One refresh: the page reads both halves through `getUserPage`.
		void getUserPage(id).refresh();
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
</script>

<!--
	getRoleCatalog is awaited here rather than in +page.svelte so the roles catalog
	is only fetched when someone actually opens this tab — the same reason every
	other panel owns its own queries. It also carries `canSetRole`, which hides
	the picker from a caller who may edit the profile but not the roles: without
	that they would submit a role set they cannot change and land on a 403.
-->
{#if roleCatalog.current}
	{@const catalog = roleCatalog.current}
	{@const roleOptions = catalog.roles.map((r) => ({ id: String(r.id), label: r.name }))}
	{@const initialRoles = catalog.roles
		.filter((r) => member.roles.includes(r.name))
		.map((r) => String(r.id))}
	<StaffUserForm {member} {roleOptions} {initialRoles} {id} canSetRole={catalog.canSetRole} />
{/if}

<EmailChangeCard {id} email={member.email} />

<RelatedList
	title={m.staff_members_id_panels_account_panel_directory_profile()}
	result={getUserDirectoryProfile(id)}
>
	{#snippet children(data)}
		{#if !data.profile}
			<EmptyState
				title={m.staff_members_id_panels_account_panel_no_profile()}
				description={m.staff_members_id_panels_account_panel_account_has_no_directo()}
			/>
		{:else}
			<DefinitionList>
				<Fact
					label={m.staff_members_id_panels_account_panel_visibility()}
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
							>{m.staff_members_id_panels_account_panel_profile_incomplete()}</span
						>
					{/if}
				</Fact>

				<Fact label={m.staff_members_id_panels_account_panel_tagline()}
					>{data.profile.tagline || '—'}</Fact
				>

				<Fact label={m.staff_members_id_panels_account_panel_hometown()}
					>{data.profile.hometown || '—'}</Fact
				>

				<Fact
					label={m.staff_members_id_panels_account_panel_instruments()}
					class="flex flex-wrap gap-1"
				>
					{#each data.profile.instruments as i (i)}
						<Badge size="sm">{i}</Badge>
					{:else}
						—
					{/each}
				</Fact>

				<Fact label={m.staff_members_id_panels_account_panel_genres()} class="flex flex-wrap gap-1">
					{#each data.profile.genres as g (g)}
						<Badge size="sm">{g}</Badge>
					{:else}
						—
					{/each}
				</Fact>

				<Fact label={m.staff_members_id_panels_account_panel_open()} class="flex flex-wrap gap-1">
					{#if data.profile.lookingForBand}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_looking_band()}</Badge
						>{/if}
					{#if data.profile.availableForHire}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_hire()}</Badge
						>{/if}
					{#if data.profile.teachesLessons}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_teaches_privately()}</Badge
						>{/if}
					{#if data.profile.openToCollaboration}<Badge size="sm"
							>{m.staff_members_id_panels_account_panel_collaboration()}</Badge
						>{/if}
					{#if !data.profile.lookingForBand && !data.profile.availableForHire && !data.profile.teachesLessons && !data.profile.openToCollaboration}
						—
					{/if}
				</Fact>
			</DefinitionList>
			<div class="mt-3">
				<Button href={resolve(`/member/directory/members/${id}`)} variant="ghost" size="sm">
					{m.staff_members_id_panels_account_panel_view_public_profile()}
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
	title={m.staff_members_id_panels_account_panel_sign_activity()}
	result={getUserSessions(id)}
>
	{#snippet children(data)}
		<p class="mb-3 text-muted">
			Last sign-in: {data.lastLoginAt ? formatDateTimeShort(data.lastLoginAt) : 'never on record'}
		</p>
		{#if data.sessions.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_account_panel_no_active_sessions()}
				description={m.staff_members_id_panels_account_panel_they_signed_out_everyw()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_started()}</th>
					<th class="col-support">{m.staff_members_id_panels_account_panel_ip()}</th>
					<th class="col-extra">{m.staff_expires()}</th>
				{/snippet}
				{#each data.sessions as s (s.id)}
					<tr class="hover">
						<td class="cell-primary">
							<div class="font-medium whitespace-nowrap">{formatDateTimeShort(s.createdAt)}</div>
							<div class="truncate text-muted">{s.userAgent ?? 'Unknown device'}</div>
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
	title={m.staff_history()}
	query={(limit) => getUserHistory(limit ? { userId: id, limit } : { userId: id })}
	toRow={feedItemRow}
	empty={{
		title: m.staff_no_recorded_changes(),
		description: m.staff_members_id_panels_account_panel_role_profile_credit_ac()
	}}
/>

<InfoCard title={m.staff_details()} class="bg-base-200 shadow-none">
	<DefinitionList>
		<Fact label={m.staff_members_id_panels_account_panel_user_id()} mono>{member.id}</Fact>

		<Fact label={m.staff_members_id_panels_account_panel_member_no()}
			>{member.memberNumber ?? '—'}</Fact
		>

		<!-- Nothing is gated on this, so "not confirmed" is not a restriction and
		     should not read like one. Every account predating #757 shows it. -->
		<Fact label={m.staff_members_id_panels_account_panel_email_confirmed()}>
			{#if member.emailVerified}
				{m.staff_yes()}
			{:else}
				<span class="text-muted"
					>{m.staff_members_id_panels_account_panel_not_yet_full_access_ei()}</span
				>
			{/if}
		</Fact>

		<Fact label={m.staff_members_id_panels_account_panel_stripe_id()} mono
			>{member.stripeId ?? '—'}</Fact
		>

		<Fact label={m.staff_joined()}>{formatHistoryTime(new Date(member.createdAt))}</Fact>

		{#if member.deletedAt}
			<Fact label={m.staff_deactivated()}>{formatHistoryTime(new Date(member.deletedAt))}</Fact>
		{/if}

		{#if member.bannedAt}
			<Fact label={m.staff_members_id_panels_account_panel_banned()}>
				{formatHistoryTime(new Date(member.bannedAt))} by {member.bannedByName ??
					'a removed account'}
			</Fact>
			<Fact label={m.staff_members_id_panels_account_panel_ban_reason()} class="whitespace-pre-line"
				>{member.banReason}</Fact
			>
		{/if}
	</DefinitionList>
</InfoCard>

{#snippet banAction()}
	<Action
		action={banUser}
		label={m.staff_members_id_panels_account_panel_ban()}
		modalTitle={m.staff_members_id_panels_account_panel_modal_title({ name: member.name })}
		submitLabel={m.staff_members_id_panels_account_panel_ban()}
		successToast={m.staff_members_id_panels_account_panel_member_banned()}
		variant="error"
		size="sm"
		onsuccess={refreshAccount}
	>
		{#snippet form()}
			<input {...banFields.id.as('hidden', id)} />
			<p class="pb-4">
				{m.staff_members_id_panels_account_panel_ban_deactivates_accoun()}
			</p>
			<FormField
				field={banFields.reason}
				type="textarea"
				label={m.staff_reason()}
				description={m.staff_members_id_panels_account_panel_staff_only_what_they_d()}
				required
			/>
		{/snippet}
	</Action>
{/snippet}

<InfoCard
	title={m.staff_members_id_panels_account_panel_danger_zone()}
	class="mt-6 border border-error/30 bg-error/5 shadow-none"
>
	{#if member.bannedAt}
		<p class="mb-3 text-muted">
			{m.staff_members_id_panels_account_panel_account_banned_lifting()}
		</p>
		<div class="flex gap-2">
			<Action
				action={unbanUser}
				label={m.staff_members_id_panels_account_panel_lift_ban()}
				successToast={m.staff_members_id_panels_account_panel_ban_lifted()}
				variant="success"
				size="sm"
				onsuccess={onReactivated}
			>
				{#snippet form()}
					<input {...unbanFields.id.as('hidden', id)} />
					<p class="py-4">
						<ParaglideMessage
							message={m.staff_members_id_panels_account_panel_lift_ban_restore_their}
							inputs={{ name: member.name }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</p>
				{/snippet}
			</Action>
		</div>
	{:else if member.deletedAt}
		<p class="mb-3 text-muted">
			{m.staff_members_id_panels_account_panel_account_deactivated_re()}
		</p>
		<div class="flex gap-2">
			<Action
				action={reactivateUser}
				label={m.staff_members_id_panels_account_panel_reactivate()}
				successToast={m.staff_members_id_panels_account_panel_account_reactivated()}
				variant="success"
				size="sm"
				onsuccess={onReactivated}
			>
				{#snippet form()}
					<input {...reactivateFields.id.as('hidden', id)} />
					<p class="py-4">{m.staff_members_id_panels_account_panel_reactivate_account()}</p>
				{/snippet}
			</Action>
			<Action
				action={purgeUser}
				label={m.staff_members_id_panels_account_panel_delete_permanently()}
				successToast={m.staff_members_id_panels_account_panel_account_deleted()}
				variant="error"
				size="sm"
				onsuccess={() => goto(resolve('/staff/members'))}
			>
				{#snippet form()}
					<input {...purgeFields.id.as('hidden', id)} />
					<p class="py-4">
						<ParaglideMessage
							message={m.staff_members_id_panels_account_panel_permanently_delete_can}
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
				message={m.staff_members_id_panels_account_panel_deactivating_signs_mem}
				inputs={{
					staff_members_id_panels_account_panel_cancelled_reservations:
						m.staff_members_id_panels_account_panel_cancelled_reservations()
				}}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>
		<div class="flex gap-2">
			<Action
				action={deactivateUser}
				label={m.staff_deactivate()}
				successToast={m.staff_members_id_panels_account_panel_account_deactivated()}
				variant="error"
				size="sm"
				onsuccess={refreshAccount}
			>
				{#snippet form()}
					<input {...deactivateFields.id.as('hidden', id)} />
					<p class="py-4">
						{m.staff_members_id_panels_account_panel_deactivate_account_all()}
					</p>
				{/snippet}
			</Action>
			{@render banAction()}
		</div>
	{/if}
</InfoCard>
