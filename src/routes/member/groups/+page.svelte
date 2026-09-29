<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { resolve } from '$app/paths';
	import JoinGroupAction from '$lib/components/groups/JoinGroupAction.svelte';
	import AnswerGroupInviteAction from '$lib/components/groups/AnswerGroupInviteAction.svelte';
	import EmailInviteCard from '$lib/components/groups/EmailInviteCard.svelte';
	import { getMemberGroups } from '$lib/remote/groups.remote';
	import { withdrawGroupApplication } from '$lib/remote/group-applications.remote';
	import { groupApplicationStatusLabels } from '$lib/config';

	// Above the awaited query, so `fields.X.as()` is not compiled async-gated.
	const withdrawFields = withdrawGroupApplication.fields;

	/**
	 * Your programs, and the ones you could join, on one page.
	 *
	 * Scoping this to your own memberships would strand discovery on a route
	 * nobody with a membership ever opens — and an `open` join policy that only
	 * existing members can see is not open at all.
	 *
	 * **No bands, in any section.** A band is a group in the data model, but this
	 * page answers *what can I be part of* and a band has no answer: bands are
	 * always `invite_only`, so they could never appear under discovery, and your
	 * own bands already have `/member/bands`, their own panel and their own
	 * sidebar group. Band discovery is `/member/directory/bands`, which is a
	 * different question and already answers it.
	 */
	const data = $derived(await getMemberGroups());

	// Invitations received and applications sent are the same waiting state
	// pointed opposite ways, so they are listed apart.
	const active = $derived(data.mine.filter((g) => g.myStatus === 'active'));
	const invited = $derived(data.mine.filter((g) => g.myStatus === 'pending'));
	const applied = $derived(data.applied);

	const statusVariant = { submitted: 'ghost', contacted: 'info', declined: 'error' } as const;

	const kindLabel = (kind: string) => (kind === 'committee' ? 'Committee' : 'Club');
</script>

<PageHeader width="3xl" title="Groups" subtitle="Clubs and committees at the Collective" />
<PageContent width="3xl">
	<InfoCard title="Your programs">
		{#if active.length === 0 && invited.length === 0 && applied.length === 0 && data.emailInvites.length === 0}
			<EmptyState description="You're not in any clubs or committees yet." />
		{:else}
			<div class="space-y-3">
				{#each active as g (g.id)}
					<Card>
						<CardBody row class="py-4">
							<div class="min-w-0">
								<a class="link font-semibold" href={resolve(`/member/groups/${g.slug}`)}>{g.name}</a
								>
								<p class="text-subtle">{kindLabel(g.kind)} · {g.memberCount} members</p>
							</div>
							<Badge variant="ghost">{g.myRole}</Badge>
						</CardBody>
					</Card>
				{/each}

				{#each invited as g (g.id)}
					<Card>
						<CardBody row class="py-4">
							<div class="min-w-0">
								<span class="font-semibold">{g.name}</span>
								<p class="text-subtle">{kindLabel(g.kind)} · invited you to join</p>
							</div>
							<AnswerGroupInviteAction groupId={g.id} groupName={g.name} />
						</CardBody>
					</Card>
				{/each}

				{#each data.emailInvites as inv (inv.id)}
					<EmailInviteCard invite={inv} kindLabel={kindLabel(inv.kind)} />
				{/each}

				{#each applied as a (a.groupId)}
					<Card>
						<CardBody row class="py-4">
							<div class="min-w-0">
								<span class="font-semibold">{a.name}</span>
								<p class="text-subtle">
									{kindLabel(a.kind)} · {a.open ? 'you applied to join' : 'your application'}
								</p>
								<!-- The reviewer's reason, where they left one: a decision you
								     cannot see is one you cannot ask about. -->
								{#if a.reviewNotes}
									<p class="mt-1 text-sm">{a.reviewNotes}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if a.status !== 'accepted'}
									<Badge variant={statusVariant[a.status]}>
										{groupApplicationStatusLabels[a.status]}
									</Badge>
								{/if}
								{#if a.open}
									<Action
										action={withdrawGroupApplication.for(a.applicationId)}
										label="Withdraw"
										aria-label={`Withdraw your application to ${a.name}`}
										variant="ghost"
										size="xs"
										confirm={a.sharedWith > 0
											? `This application also names ${a.sharedWith} other ${a.sharedWith === 1 ? 'committee' : 'committees'}, and withdrawing takes it back from all of them. Anything already decided stays decided.`
											: 'Withdraw this application?'}
										successToast="Application withdrawn"
									>
										{#snippet form()}
											<input {...withdrawFields.applicationId.as('hidden', a.applicationId)} />
										{/snippet}
									</Action>
								{/if}
							</div>
						</CardBody>
					</Card>
				{/each}
			</div>
		{/if}
	</InfoCard>

	{#if data.open.length > 0}
		<InfoCard title="Open to join">
			<div class="space-y-3">
				{#each data.open as g (g.id)}
					<Card>
						<CardBody row class="py-4">
							<div class="min-w-0">
								<span class="font-semibold">{g.name}</span>
								<p class="text-subtle">{g.joinInstructions ?? g.bio ?? kindLabel(g.kind)}</p>
							</div>
							<JoinGroupAction
								groupId={g.id}
								groupName={g.name}
								slug={g.slug}
								kind={g.kind}
								policy="open"
								instructions={g.joinInstructions}
							/>
						</CardBody>
					</Card>
				{/each}
			</div>
		</InfoCard>
	{/if}

	{#if data.byApplication.length > 0}
		<InfoCard title="Apply to join">
			<div class="space-y-3">
				{#each data.byApplication as g (g.id)}
					<Card>
						<CardBody row class="py-4">
							<div class="min-w-0">
								<span class="font-semibold">{g.name}</span>
								<p class="text-subtle">{g.joinInstructions ?? g.bio ?? kindLabel(g.kind)}</p>
							</div>
							<JoinGroupAction
								groupId={g.id}
								groupName={g.name}
								slug={g.slug}
								kind={g.kind}
								policy="by_application"
								instructions={g.joinInstructions}
							/>
						</CardBody>
					</Card>
				{/each}
			</div>
		</InfoCard>
	{/if}

	{#if data.inviteOnly.length > 0}
		<!-- Listed with their instructions and no action. Seeing that a committee
		     exists is the point; the way in is a conversation. -->
		<InfoCard title="Invite only">
			<div class="space-y-3">
				{#each data.inviteOnly as g (g.id)}
					<Card>
						<CardBody row class="py-4">
							<div class="min-w-0">
								<span class="font-semibold">{g.name}</span>
								<p class="text-subtle">{g.joinInstructions ?? g.bio ?? kindLabel(g.kind)}</p>
							</div>
						</CardBody>
					</Card>
				{/each}
			</div>
		</InfoCard>
	{/if}
</PageContent>
