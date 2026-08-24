<script lang="ts">
	import {
		getUser,
		getAllRoles,
		getUserOverview,
		getUserSessions,
		deactivateUser,
		reactivateUser,
		purgeUser
	} from '$lib/remote/users.remote';
	import { getUserDirectoryProfile } from '$lib/remote/directory.remote';
	import StaffUserForm from '../StaffUserForm.svelte';
	import { RelatedList } from '$lib/components/shared/entity';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatDateTimeShort, formatDateShortYear } from '$lib/utils/format';

	let { id, member }: { id: string; member: Awaited<ReturnType<typeof getUser>> } = $props();

	const { fields: deactivateFields } = deactivateUser;
	const { fields: reactivateFields } = reactivateUser;
	const { fields: purgeFields } = purgeUser;

	// Deactivating cancels bookings and the subscription, so the scoreboard and
	// the needs-attention list are both wrong until the overview is re-read.
	function refreshAccount() {
		void getUser(id).refresh();
		void getUserOverview(id).refresh();
	}
</script>

<!--
	getAllRoles is awaited here rather than in +page.svelte so the roles catalog
	is only fetched when someone actually opens this tab — the same reason every
	other panel owns its own queries.
-->
{#await getAllRoles() then allRoles}
	{@const roleOptions = (allRoles ?? []).map((r) => ({ id: String(r.id), label: r.name }))}
	{@const initialRoles = (allRoles ?? [])
		.filter((r) => member.roles.includes(r.name))
		.map((r) => String(r.id))}
	<StaffUserForm {member} {roleOptions} {initialRoles} {id} />
{/await}

<RelatedList title="Directory profile" result={getUserDirectoryProfile(id)}>
	{#snippet children(data)}
		{#if !data.profile}
			<EmptyState title="No profile" description="This account has no directory profile row." />
		{:else}
			<DefinitionList>
				<Fact label="Visibility" class="flex items-center gap-2">
					<Badge
						size="sm"
						variant={data.profile.directoryVisibility === 'hidden' ? 'ghost' : 'info'}
					>
						{data.profile.directoryVisibility}
					</Badge>
					{#if !data.complete}
						<span class="opacity-60">Profile incomplete</span>
					{/if}
				</Fact>

				<Fact label="Tagline">{data.profile.tagline || '—'}</Fact>

				<Fact label="Hometown">{data.profile.hometown || '—'}</Fact>

				<Fact label="Instruments" class="flex flex-wrap gap-1">
					{#each data.profile.instruments as i (i)}
						<Badge size="sm">{i}</Badge>
					{:else}
						—
					{/each}
				</Fact>

				<Fact label="Genres" class="flex flex-wrap gap-1">
					{#each data.profile.genres as g (g)}
						<Badge size="sm">{g}</Badge>
					{:else}
						—
					{/each}
				</Fact>

				<Fact label="Open to" class="flex flex-wrap gap-1">
					{#if data.profile.lookingForBand}<Badge size="sm">Looking for a band</Badge>{/if}
					{#if data.profile.availableForHire}<Badge size="sm">For hire</Badge>{/if}
					{#if data.profile.teachesLessons}<Badge size="sm">Teaches lessons</Badge>{/if}
					{#if data.profile.openToCollaboration}<Badge size="sm">Collaboration</Badge>{/if}
					{#if !data.profile.lookingForBand && !data.profile.availableForHire && !data.profile.teachesLessons && !data.profile.openToCollaboration}
						—
					{/if}
				</Fact>
			</DefinitionList>
			<div class="mt-3">
				<Button href={resolve(`/member/directory/members/${id}`)} variant="ghost" size="sm">
					View public profile
				</Button>
			</div>
		{/if}
	{/snippet}
</RelatedList>

<!--
	Read-only. Revoking a session would be a new mutation, and the one lever staff
	already have for cutting off access — deactivation — deletes them all.
-->
<RelatedList title="Sign-in activity" result={getUserSessions(id)}>
	{#snippet children(data)}
		<p class="mb-3 text-muted">
			Last sign-in: {data.lastLoginAt ? formatDateTimeShort(data.lastLoginAt) : 'never on record'}
		</p>
		{#if data.sessions.length === 0}
			<EmptyState
				title="No active sessions"
				description="They are signed out everywhere, or their sessions have expired."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>Started</th>
					<th class="col-support">IP</th>
					<th class="col-extra">Expires</th>
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

<InfoCard title="Details" class="bg-base-200 shadow-none">
	<DefinitionList>
		<Fact label="User ID" mono>{member.id}</Fact>

		<Fact label="Member no.">{member.memberNumber ?? '—'}</Fact>

		<Fact label="Email verified">{member.emailVerified ? 'Yes' : 'No'}</Fact>

		<Fact label="Stripe ID" mono>{member.stripeId ?? '—'}</Fact>

		<Fact label="Joined">{new Date(member.createdAt).toLocaleString()}</Fact>

		{#if member.deletedAt}
			<Fact label="Deactivated">{new Date(member.deletedAt).toLocaleString()}</Fact>
		{/if}
	</DefinitionList>
</InfoCard>

<InfoCard title="Danger Zone" class="mt-6 border border-error/30 bg-error/5 shadow-none">
	{#if member.deletedAt}
		<p class="mb-3 text-muted">
			This account is deactivated. Reactivate it to restore access, or permanently delete it.
		</p>
		<div class="flex gap-2">
			<Action
				action={reactivateUser}
				label="Reactivate"
				successToast="Account reactivated"
				variant="success"
				size="sm"
				onsuccess={refreshAccount}
			>
				{#snippet form()}
					<input {...reactivateFields.id.as('hidden', id)} />
					<p class="py-4">Reactivate this account?</p>
				{/snippet}
			</Action>
			<Action
				action={purgeUser}
				label="Delete permanently"
				successToast="Account deleted"
				variant="error"
				size="sm"
				onsuccess={() => goto(resolve('/staff/users'))}
			>
				{#snippet form()}
					<input {...purgeFields.id.as('hidden', id)} />
					<p class="py-4">
						Permanently delete <strong>{member.name}</strong>? This cannot be undone. The account
						must own no bands.
					</p>
				{/snippet}
			</Action>
		</div>
	{:else}
		<p class="mb-3 text-muted">
			Deactivating signs this member out, hides them from the directory, cancels all of their future
			reservations, and cancels their membership subscription. Reactivating restores their access,
			but <strong>the cancelled reservations and subscription are not restored</strong> — they would have
			to be rebooked and resubscribed.
		</p>
		<Action
			action={deactivateUser}
			label="Deactivate"
			successToast="Account deactivated"
			variant="error"
			size="sm"
			onsuccess={refreshAccount}
		>
			{#snippet form()}
				<input {...deactivateFields.id.as('hidden', id)} />
				<p class="py-4">
					Deactivate this account? All future reservations and their membership subscription will be
					cancelled, and reactivating will not bring them back.
				</p>
			{/snippet}
		</Action>
	{/if}
</InfoCard>
