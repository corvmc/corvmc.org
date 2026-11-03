<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { formatDateShort, formatDateShortYear } from '#lib/utils/format.js';
	import {
		DeleteAudienceAction,
		BulkAddMembersAction,
		AddSubscriberAction,
		RemoveSubscriberAction
	} from '#lib/components/actions/index.js';
	import { getStaffAudienceDetail, updateAudience } from '#lib/remote/marketing.remote.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';

	const { fields } = updateAudience;

	let id = $derived(page.params.id!);
	const data = $derived(await getStaffAudienceDetail(id));
	const audienceData = $derived(data.audience);
	const subscribers = $derived(data.subscribers);

	// A built-in audience's membership is a SQL predicate over member
	// attributes, so every list-editing control below is meaningless for it.
	let isBuiltIn = $derived(Boolean(audienceData.systemKey));

	// Local mirror of the opt-in setting so the toggle submits an explicit boolean
	// (the previous string-only checkbox could turn opt-in on but never off). A
	// writable $derived tracks the server value but lets the toggle reassign it.
	let allowOptIn = $derived(audienceData.allowOptIn);
</script>

<PageHeader subtitle={m.staff_audience()} title={audienceData.name}>
	<!-- Not gated on `isBuiltIn`: `updateAudience` refuses a built-in's *slug*
	     and its opt-in, and says in its own comment that "name and description
	     are staff-editable copy". Before this there was no way to change either
	     on any audience, built-in or not (#1074). -->
	<Action
		action={updateAudience}
		label={m.staff_marketing_audiences_id_rename()}
		modalTitle={m.staff_marketing_audiences_id_modal_title()}
		submitLabel={m.staff_save()}
		successToast={m.staff_marketing_audiences_id_audience_updated()}
		variant="ghost"
		size="sm"
	>
		{#snippet form()}
			<input {...fields.id.as('hidden', id)} />
			<FormField
				field={fields.name}
				type="text"
				label={m.staff_name()}
				value={audienceData.name}
				required
			/>
			<FormField
				field={fields.description}
				type="textarea"
				label={m.staff_description()}
				value={audienceData.description ?? ''}
				description={m.staff_marketing_audiences_id_what_list_staff_only_subscriber()}
			/>
		{/snippet}
	</Action>
	{#if !isBuiltIn}
		<DeleteAudienceAction
			audienceId={id}
			onsuccess={() => goto(resolve('/staff/marketing/audiences'))}
		/>
	{/if}
</PageHeader>
<PageContent>
	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title={m.staff_details()}>
			<DefinitionList>
				<Fact label={m.staff_slug()} mono>{audienceData.slug}</Fact>

				<Fact label={m.staff_subscribers()}>
					{audienceData.subscriberCount}
					{isBuiltIn
						? m.staff_marketing_audiences_id_matching_members()
						: m.staff_marketing_audiences_id_active()}
				</Fact>

				<Fact label={m.staff_opt()}>
					{#if isBuiltIn}
						<Badge variant="info" size="xs">{m.staff_built()}</Badge>
					{:else}
						{audienceData.allowOptIn ? m.staff_public() : m.staff_staff_only()}
					{/if}
				</Fact>

				<Fact label={m.staff_created()}
					>{formatDateShortYear(new Date(audienceData.createdAt))}</Fact
				>
			</DefinitionList>

			{#if audienceData.description}
				<p class="mt-3 text-muted">{audienceData.description}</p>
			{/if}

			{#if isBuiltIn}
				<p class="mt-3 text-muted">
					{m.staff_marketing_audiences_id_membership_worked_out_from_memb()}
				</p>
			{/if}

			{#if audienceData.allowOptIn}
				<div class="mt-3 rounded bg-base-200 p-2 text-xs">
					<span class="opacity-60">{m.staff_marketing_audiences_id_signup_url()}</span>
					<code class="ml-1">/subscribe/{audienceData.slug}</code>
				</div>
			{/if}
		</InfoCard>

		{#if !isBuiltIn}
			<InfoCard title={m.staff_actions()}>
				<div class="space-y-3">
					<BulkAddMembersAction audienceId={id} />

					<Form
						remote={updateAudience}
						successToast={m.staff_marketing_audiences_id_opt_setting_updated()}
					>
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
							<span class="text-sm">{m.staff_marketing_audiences_id_allow_public_opt()}</span>
						</label>
					</Form>
				</div>
			</InfoCard>
		{/if}
	</div>

	{#if !isBuiltIn}
		<!-- The button, not a titled box around the button (#1078). -->
		<div class="mb-6"><AddSubscriberAction audienceId={id} /></div>
	{/if}

	<!-- Subscriber List -->
	<InfoCard
		title={isBuiltIn
			? m.staff_marketing_audiences_id_matching_members_showing({
					length: subscribers.length,
					subscriberCount: audienceData.subscriberCount
				})
			: m.staff_marketing_audiences_id_subscribers({
					subscriberCount: audienceData.subscriberCount
				})}
	>
		{#if subscribers.length === 0}
			<EmptyState
				description={isBuiltIn
					? m.staff_marketing_audiences_id_no_members_currently_match()
					: m.staff_marketing_audiences_id_no_subscribers_yet()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_marketing_audiences_id_subscriber()}</th>
					<!-- A built-in's preview already excludes opt-outs, so every row
					     would read "Active". -->
					{#if !isBuiltIn}
						<th class="col-support w-px">{m.staff_status()}</th>
					{/if}
					<th class="col-extra whitespace-nowrap"
						>{isBuiltIn ? m.staff_marketing_audiences_id_member_since() : m.staff_joined()}</th
					>
					{#if !isBuiltIn}
						<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
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
									{s.unsubscribedAt
										? m.staff_marketing_audiences_id_unsubscribed()
										: m.staff_active()}
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
