<script lang="ts">
	import { getUserThreads } from '$lib/remote/inbox.remote';
	import { getUserNotifications } from '$lib/remote/notifications.remote';
	import { getUserMarketing } from '$lib/remote/marketing.remote';
	import { RelatedList } from '$lib/components/shared/entity';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateShortYear, relativeDay } from '$lib/utils/format';

	let { id, email }: { id: string; email: string } = $props();
</script>

<!--
	One question: how we reach this member, and why a message might not have
	landed. Standings and reports used to sit at the top of this file, which meant
	the panel answered that question and "what has this member done" at the same
	time; they are the Moderation tab now.
-->
<RelatedList title="Conversations" result={getUserThreads({ userId: id, email })}>
	{#snippet children(data)}
		{@const groups = [
			{ label: 'Portal', rows: data.portal },
			{ label: 'By email address', rows: data.byEmail }
		]}
		{#if data.portal.length === 0 && data.byEmail.length === 0}
			<EmptyState
				title="No conversations"
				description="Nothing in the inbox from this member, by portal or by email."
			/>
		{:else}
			<p class="mb-3 text-muted">
				{data.open} open · {data.unread} unread by them
			</p>
			{#each groups as group (group.label)}
				{#if group.rows.length > 0}
					<h4 class="mt-3 mb-1 text-subtle font-semibold uppercase">{group.label}</h4>
					<Table>
						{#snippet head()}
							<th class="w-px"><span class="sr-only">Status</span></th>
							<th>Subject</th>
							<th class="col-extra">Last message</th>
						{/snippet}
						{#each group.rows as t (t.id)}
							<tr class="hover" use:rowLink={resolve(`/staff/inbox/${t.id}`)}>
								<td class="w-px"><StatusBadge status={t.status} /></td>
								<td class="cell-primary">
									<a class="font-medium" href={resolve(`/staff/inbox/${t.id}`)}>
										{t.subject ?? '(no subject)'}
									</a>
									<div class="text-muted">{t.preview ?? ''}</div>
								</td>
								<td class="col-extra whitespace-nowrap">
									{t.lastMessageAt ? relativeDay(t.lastMessageAt) : '—'}
								</td>
							</tr>
						{/each}
					</Table>
				{/if}
			{/each}
		{/if}
	{/snippet}
</RelatedList>

<!--
	Preferences alongside the sends, because the question they answer together is
	"why didn't they get the email?" — which is unanswerable from either half.
-->
<RelatedList title="Notifications" result={getUserNotifications(id)}>
	{#snippet children(data)}
		<h4 class="mb-1 text-subtle font-semibold uppercase">Channels</h4>
		{@const overrides = Object.entries(data.preferences)}
		{#if overrides.length === 0}
			<p class="mb-4 text-muted">All defaults — nothing has been turned off for this member.</p>
		{:else}
			<!-- Only types they have changed are stored, so this list is the set of
			     deliberate overrides rather than the whole catalogue. Everything
			     absent is on. -->
			<div class="mb-4 flex flex-wrap gap-1">
				{#each overrides as [type, pref] (type)}
					<Badge size="sm" variant={pref.email || pref.inApp ? undefined : 'ghost'}>
						{type.replace(/_/g, ' ')}
						{[pref.email && 'email', pref.inApp && 'in-app', pref.sms && 'SMS']
							.filter(Boolean)
							.join(' · ') || 'off'}
					</Badge>
				{/each}
			</div>
		{/if}

		<h4 class="mt-3 mb-1 text-subtle font-semibold uppercase">
			Recent ({data.unread} unread)
		</h4>
		{#if data.items.length === 0}
			<p class="text-muted">Nothing sent yet.</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each data.items as n (n.id)}
					<li class="text-sm">
						<span class="font-medium">{n.title}</span>
						<span class="opacity-60"> · {relativeDay(n.createdAt)}</span>
						{#if !n.readAt}
							<Badge size="sm" variant="info">Unread</Badge>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList title="Email lists" result={getUserMarketing(id)}>
	{#snippet children(data)}
		{#if !data.subscriber}
			<EmptyState
				title="Not a subscriber"
				description="No marketing subscriber record is linked to this account."
			/>
		{:else}
			{#if data.subscriber.suppressedAt}
				<Alert type="warning" class="mb-3">
					Suppressed{data.subscriber.suppressionReason
						? ` (${data.subscriber.suppressionReason})`
						: ''} since {formatDateShortYear(data.subscriber.suppressedAt)} — club mail is not being delivered.
				</Alert>
			{/if}
			<div class="flex flex-wrap gap-1">
				{#each data.audiences as a (a.audienceId)}
					<a href={resolve(`/staff/marketing/audiences/${a.audienceId}`)}>
						<Badge size="sm">{a.audienceName}</Badge>
					</a>
				{:else}
					<span class="text-muted">Not on any list.</span>
				{/each}
			</div>
		{/if}
	{/snippet}
</RelatedList>
