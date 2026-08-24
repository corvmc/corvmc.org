<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import {
		DeleteAudienceAction,
		BulkAddMembersAction,
		AddSubscriberAction,
		RemoveSubscriberAction
	} from '$lib/components/shared/actions';
	import {
		getAudienceDetail,
		getAudienceSubscribers,
		updateAudience
	} from '$lib/remote/marketing.remote';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';

	const { fields } = updateAudience;

	let id = $derived(page.params.id!);
	let audienceData = $derived(await getAudienceDetail(id));
	let subscribers = $derived(await getAudienceSubscribers(id));

	// A built-in audience's membership is a SQL predicate over member
	// attributes, so every list-editing control below is meaningless for it.
	let isBuiltIn = $derived(Boolean(audienceData?.systemKey));

	// Local mirror of the opt-in setting so the toggle submits an explicit boolean
	// (the previous string-only checkbox could turn opt-in on but never off). A
	// writable $derived tracks the server value but lets the toggle reassign it.
	let allowOptIn = $derived(audienceData?.allowOptIn ?? false);
</script>

{#if audienceData}
	<PageHeader subtitle="Audience" title={audienceData.name} backHref="/staff/marketing/audiences">
		{#if !isBuiltIn}
			<DeleteAudienceAction
				audienceId={id}
				onsuccess={() => goto(resolve('/staff/marketing/audiences'))}
			/>
		{/if}
	</PageHeader>
	<PageContent width="3xl">
		<div class="grid gap-6 lg:grid-cols-2 mb-6">
			<InfoCard title="Details">
				<DefinitionList>
					<Fact label="Slug" mono>{audienceData.slug}</Fact>

					<Fact label="Subscribers">
						{audienceData.subscriberCount}
						{isBuiltIn ? 'matching members' : 'active'}
					</Fact>

					<Fact label="Opt-in">
						{#if isBuiltIn}
							<Badge variant="info" size="xs">Built-in</Badge>
						{:else}
							{audienceData.allowOptIn ? 'Public' : 'Staff only'}
						{/if}
					</Fact>

					<Fact label="Created">{new Date(audienceData.createdAt).toLocaleDateString()}</Fact>
				</DefinitionList>

				{#if audienceData.description}
					<p class="text-muted mt-3">{audienceData.description}</p>
				{/if}

				{#if isBuiltIn}
					<p class="text-muted mt-3">
						Membership is worked out from member attributes each time you send, so this list is
						always current — there is nothing to refresh. Subscribers without a member account, such
						as public newsletter signups, are never included.
					</p>
				{/if}

				{#if audienceData.allowOptIn}
					<div class="mt-3 p-2 bg-base-200 rounded text-xs">
						<span class="opacity-60">Signup URL:</span>
						<code class="ml-1">/subscribe/{audienceData.slug}</code>
					</div>
				{/if}
			</InfoCard>

			{#if !isBuiltIn}
				<InfoCard title="Actions">
					<div class="space-y-3">
						<BulkAddMembersAction audienceId={id} />

						<Form remote={updateAudience} successToast="Opt-in setting updated">
							<input {...fields.id.as('hidden', id)} />
							<input {...fields.allowOptIn.as('hidden', allowOptIn)} />
							<label class="label cursor-pointer justify-start gap-3">
								<input
									type="checkbox"
									class="toggle toggle-sm"
									bind:checked={allowOptIn}
									onchange={(e) => {
										(e.target as HTMLInputElement).form?.requestSubmit();
									}}
								/>
								<span class="text-sm">Allow public opt-in</span>
							</label>
						</Form>
					</div>
				</InfoCard>
			{/if}
		</div>

		{#if !isBuiltIn}
			<!-- Add Subscriber -->
			<InfoCard title="Add Subscriber" class="mb-6">
				<AddSubscriberAction audienceId={id} />
			</InfoCard>
		{/if}

		<!-- Subscriber List -->
		<InfoCard
			title={isBuiltIn
				? `Matching members (showing ${subscribers.length} of ${audienceData.subscriberCount})`
				: `Subscribers (${audienceData.subscriberCount})`}
		>
			{#if subscribers.length === 0}
				<EmptyState description={isBuiltIn ? 'No members currently match' : 'No subscribers yet'} />
			{:else}
				<Table>
					{#snippet head()}
						<th>Subscriber</th>
						<!-- A built-in's preview already excludes opt-outs, so every row
						     would read "Active". -->
						{#if !isBuiltIn}
							<th class="col-support w-px">Status</th>
						{/if}
						<th class="col-extra whitespace-nowrap">{isBuiltIn ? 'Member since' : 'Joined'}</th>
						{#if !isBuiltIn}
							<th class="w-px"><span class="sr-only">Actions</span></th>
						{/if}
					{/snippet}
					<!-- Keyed by email: a built-in's preview rows come from `user`, where a
					     member with no subscriber record yet has a null subscriberId. -->
					{#each subscribers as s (s.email)}
						<tr class="hover">
							<!-- Name was its own column; it qualifies the address, so it is the
							     subline. -->
							<td class="cell-primary">
								<div class="truncate font-mono text-sm">{s.email}</div>
								{#if s.name}
									<div class="truncate text-muted">{s.name}</div>
								{/if}
							</td>
							{#if !isBuiltIn}
								<td class="col-support w-px">
									<Badge variant={s.unsubscribedAt ? 'ghost' : 'success'} size="xs">
										{s.unsubscribedAt ? 'Unsubscribed' : 'Active'}
									</Badge>
								</td>
							{/if}
							<td class="col-extra whitespace-nowrap">{formatDateShort(s.createdAt)}</td>
							{#if !isBuiltIn && s.subscriberId}
								<td class="w-px">
									<RemoveSubscriberAction
										audienceId={id}
										subscriberId={s.subscriberId}
										email={s.email}
									/>
								</td>
							{/if}
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	</PageContent>
{/if}
