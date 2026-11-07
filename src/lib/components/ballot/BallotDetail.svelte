<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	/**
	 * One ballot, for everyone who can see it: the vote for an elector, the
	 * result once it may be read, and the draft controls for its managers.
	 * Mounted by `/member/ballots/[id]` and `/staff/ballots/[id]`.
	 */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { startProjectFromBallotForm } from '#lib/remote/projects.remote.js';
	import { ballotKindLabels, ballotStatusLabels, DEFAULT_TIMEZONE } from '#lib/config.js';
	import { formatDateTime, formatDateShortYear } from '#lib/utils/format.js';
	import {
		cancelBallotForm,
		castBallotVote,
		certifyBallotForm,
		changeBallotCertifier,
		openBallotForm,
		setElectorOverrideForm,
		updateBallotDraft,
		type getBallotPage
	} from '#lib/remote/ballots.remote.js';

	type Page = Awaited<ReturnType<typeof getBallotPage>>;

	let { data, panel }: { data: Page; panel: 'member' | 'staff' } = $props();

	// Above anything async-gated, as on the staff suggestion page.
	const startFields = startProjectFromBallotForm.fields;

	const b = $derived(data.ballot);
	const viewer = $derived(data.viewer);
	const secret = $derived(b.kind === 'member');
	const optionLabel = $derived(new Map(b.options.map((o) => [o.id, o.label])));
	const voteOptions = $derived(b.options.map((o) => ({ value: o.id, label: o.label })));
	const outcomeOptions = [
		{ value: 'passed', label: msg.ballot_ballot_detail_passed_authorises_work() },
		{ value: 'not_passed', label: msg.ballot_ballot_detail_not_passed() }
	];
	const certifierOptions = $derived(
		(data.certifierChoices ?? []).map((m) => ({ value: m.id, label: m.name }))
	);

	/** The draft's close day, as the date field wants it, in the collective's zone. */
	const closesOn = $derived(
		new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(b.closesAt)
	);

	let overrideUserId = $state('');
	let overrideUserName = $state('');
	let certifierId = $state('');
	let certifierName = $state('');

	const decides = $derived(data.decides);
	const suggestionHref = $derived(
		decides.suggestion
			? panel === 'staff' && viewer.canReadSuggestions
				? resolve(`staff/suggestions/${decides.suggestion.id}`)
				: resolve(`member/suggestions/${decides.suggestion.id}`)
			: null
	);
	const projectHref = (id: string) =>
		viewer.canReadProjects ? resolve(`staff/projects/${id}`) : null;

	function share(votes: number, turnout: number) {
		return turnout === 0 ? '—' : `${Math.round((votes / turnout) * 100)}%`;
	}
</script>

<PageHeader title={b.title} subtitle={b.group?.name ?? ballotKindLabels[b.kind]} width="3xl">
	{#if viewer.isManager && b.status === 'draft'}
		<Action
			action={updateBallotDraft}
			label={msg.ballot_ballot_detail_edit()}
			modalTitle={msg.ballot_ballot_detail_edit_draft()}
			submitLabel={msg.ballot_ballot_detail_save()}
			successToast={msg.ballot_ballot_detail_draft_saved()}
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...updateBallotDraft.fields.ballotId.as('hidden', b.id)} />
				<FormField
					field={updateBallotDraft.fields.title}
					type="text"
					label={msg.ballot_ballot_detail_question()}
					value={b.title}
				/>
				<FormField
					field={updateBallotDraft.fields.description}
					type="textarea"
					label={msg.ballot_ballot_detail_background_optional()}
					value={b.description ?? ''}
				/>
				<FormField
					field={updateBallotDraft.fields.options}
					type="textarea"
					label={msg.ballot_ballot_detail_choices()}
					description={msg.ballot_ballot_detail_one_per_line_between_2()}
					value={b.options.map((o) => o.label).join('\n')}
				/>
				<FormField
					field={updateBallotDraft.fields.closesOn}
					type="date"
					label={msg.ballot_ballot_detail_voting_closes_at_end()}
					value={closesOn}
				/>
				{#if b.kind === 'group'}
					<FormField
						field={updateBallotDraft.fields.certifierId}
						type="select"
						label={msg.ballot_ballot_detail_certifier()}
						options={certifierOptions}
						value={b.certifier?.id ?? ''}
					/>
				{:else}
					<input {...updateBallotDraft.fields.certifierId.as('hidden', b.certifier?.id ?? '')} />
				{/if}
			{/snippet}
		</Action>
		<Action
			action={openBallotForm}
			label={msg.ballot_ballot_detail_open_voting()}
			modalTitle={msg.ballot_ballot_detail_open_voting()}
			submitLabel={msg.ballot_ballot_detail_open()}
			successToast={msg.ballot_ballot_detail_voting_open()}
			size="sm"
		>
			{#snippet form()}
				<input {...openBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p>
					{msg.ballot_ballot_detail_opening_freezes_roll_people_can({
						value: data.previewSize ?? 0,
						count: data.previewSize ?? 0
					})}
				</p>
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isManager && (b.status === 'open' || b.status === 'closed')}
		<Action
			action={changeBallotCertifier}
			label={msg.ballot_ballot_detail_change_certifier()}
			modalTitle={msg.ballot_ballot_detail_change_certifier_2()}
			submitLabel={msg.ballot_ballot_detail_save()}
			successToast={msg.ballot_ballot_detail_certifier_changed()}
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...changeBallotCertifier.fields.ballotId.as('hidden', b.id)} />
				{#if b.kind === 'group'}
					<FormField
						field={changeBallotCertifier.fields.certifierId}
						type="select"
						label={msg.ballot_ballot_detail_certifier()}
						options={certifierOptions}
						value={b.certifier?.id ?? ''}
					/>
				{:else}
					<MemberPicker
						field={changeBallotCertifier.fields.certifierId}
						label={msg.ballot_ballot_detail_certifier()}
						bind:value={certifierId}
						bind:name={certifierName}
					/>
				{/if}
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isManager && b.status !== 'certified' && b.status !== 'cancelled'}
		<Action
			action={cancelBallotForm}
			label={msg.ballot_ballot_detail_cancel_ballot()}
			modalTitle={msg.ballot_ballot_detail_cancel_ballot_2()}
			submitLabel={msg.ballot_ballot_detail_cancel_ballot()}
			submitVariant="error"
			successToast={msg.ballot_ballot_detail_ballot_cancelled()}
			variant="error"
			outline
			size="sm"
		>
			{#snippet form()}
				<input {...cancelBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p class="mb-3">
					{msg.ballot_ballot_detail_cancelling_final_no_result_ever()}
				</p>
				<FormField
					field={cancelBallotForm.fields.reason}
					type="textarea"
					label={msg.ballot_ballot_detail_why()}
				/>
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isCertifier && (b.status === 'closed' || data.needsOutcome)}
		<Action
			action={certifyBallotForm}
			label={data.needsOutcome
				? msg.ballot_ballot_detail_record_outcome()
				: msg.ballot_ballot_detail_certify_result()}
			modalTitle={data.needsOutcome
				? msg.ballot_ballot_detail_record_outcome()
				: msg.ballot_ballot_detail_certify_result()}
			submitLabel={data.needsOutcome
				? msg.ballot_ballot_detail_record()
				: msg.ballot_ballot_detail_certify()}
			successToast={data.needsOutcome
				? msg.ballot_ballot_detail_outcome_recorded()
				: msg.ballot_ballot_detail_result_certified_published()}
			size="sm"
		>
			{#snippet form()}
				<input {...certifyBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p class="mb-3">
					{#if data.needsOutcome}{msg.ballot_ballot_detail_result_was_certified_before_outcome()}{:else}{msg.ballot_ballot_detail_certifying_fixes_result_below_as()}{/if}
				</p>
				<FormField
					field={certifyBallotForm.fields.outcome}
					type="select"
					label={msg.ballot_ballot_detail_outcome()}
					placeholder={msg.ballot_ballot_detail_placeholder()}
					options={outcomeOptions}
					description={msg.ballot_ballot_detail_call_not_leading_choice_not()}
				/>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if decides.suggestion || decides.project || data.authorised || data.startProject}
		<InfoCard title={msg.ballot_ballot_detail_what_decides()}>
			<DefinitionList>
				{#if decides.suggestion}
					<Fact label={msg.ballot_ballot_detail_suggestion()}>
						<a class="link" href={suggestionHref}>{decides.suggestion.title}</a>
						<StatusBadge status={decides.suggestion.status} label />
					</Fact>
				{/if}
				{#if decides.project}
					{@const href = projectHref(decides.project.id)}
					<Fact label={msg.ballot_ballot_detail_project()}>
						{#if href}<a class="link" {href}>{decides.project.name}</a>{:else}{decides.project
								.name}{/if}
					</Fact>
				{/if}
				{#if b.status === 'certified'}
					<Fact
						label={msg.ballot_ballot_detail_outcome()}
						value={data.passed === null
							? 'Not recorded by the certifier'
							: data.passed
								? 'Passed'
								: 'Did not pass'}
					/>
				{/if}
				{#if data.authorised}
					{@const href = projectHref(data.authorised.id)}
					<Fact label={msg.ballot_ballot_detail_became_project()}>
						{#if href}<a class="link" {href}>{data.authorised.name}</a>{:else}{data.authorised
								.name}{/if}
						<StatusBadge status={data.authorised.status} label />
					</Fact>
				{/if}
			</DefinitionList>
			{#if data.startProject}
				{@const start = data.startProject}
				<div class="mt-3">
					<Action
						action={startProjectFromBallotForm}
						label={msg.ballot_ballot_detail_start_project()}
						modalTitle={msg.ballot_ballot_detail_start_project_ballot_authorised()}
						submitLabel={msg.ballot_ballot_detail_start()}
						successToast={msg.ballot_ballot_detail_project_started()}
						variant="primary"
						size="sm"
						onsuccess={(r) => {
							if (r && typeof r === 'object' && 'id' in r) {
								void goto(resolve(`staff/projects/${r.id as string}`));
							}
						}}
					>
						{#snippet form()}
							<input {...startFields.ballotId.as('hidden', b.id)} />
							<p class="mb-3 text-muted">
								{(decides.suggestion
									? msg.ballot_ballot_detail_project_linked_ballot_suggestion_decide
									: msg.ballot_ballot_detail_project_linked_ballot)()}
							</p>
							<Field
								field={startFields.name}
								type="text"
								label={msg.ballot_ballot_detail_project_name()}
								value={start.name}
							/>
							<Field
								field={startFields.groupId}
								type="select"
								label={msg.ballot_ballot_detail_owning_committee()}
								placeholder={msg.ui_none()}
								options={start.committees.map((c) => ({ value: c.id, label: c.name }))}
								description={msg.ballot_ballot_detail_only_committee_can_own_project()}
							/>
							<MoneyField
								field={startFields.budgetCents}
								label={msg.ballot_ballot_detail_budget()}
							/>
						{/snippet}
					</Action>
				</div>
			{/if}
		</InfoCard>
	{/if}

	{#if b.status === 'cancelled'}
		<Alert type="warning"
			>{msg.ballot_ballot_detail_ballot_was_cancelled({
				cancelReason: b.cancelReason ?? ''
			})}</Alert
		>
	{:else if b.status === 'certified' && b.certifiedAt}
		<Alert type="success">
			{msg.ballot_ballot_detail_certified_by({
				value: b.certifier?.name ?? msg.ballot_ballot_detail_certifier_2(),
				formatDateShortYear: formatDateShortYear(b.certifiedAt)
			})}
		</Alert>
	{:else if b.status === 'closed'}
		<Alert type="info">
			{viewer.isCertifier
				? msg.ballot_ballot_detail_closed_certify()
				: msg.ballot_ballot_detail_closed_waiting({
						name: b.certifier?.name ?? msg.ballot_ballot_detail_certifier_2()
					})}
		</Alert>
	{/if}

	{#if b.description}
		<InfoCard title={msg.ballot_ballot_detail_background()}>
			<p class="whitespace-pre-wrap">{b.description}</p>
		</InfoCard>
	{/if}

	{#if viewer.isElector && b.status === 'open'}
		<InfoCard title={msg.ballot_ballot_detail_vote()}>
			{#if secret && data.myVote?.voted}
				<p>
					{msg.ballot_ballot_detail_vote_secret_app_records_voted()}
				</p>
			{:else}
				{#if data.myVote?.optionId}
					<p class="mb-3">
						<ParaglideMessage
							message={msg.ballot_ballot_detail_voted_recorded_vote_can_change}
							inputs={{ option: optionLabel.get(data.myVote.optionId) ?? '' }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</p>
				{:else if secret}
					<p class="mb-3">
						{msg.ballot_ballot_detail_secret_ballot_nobody_will_able()}
					</p>
				{:else}
					<p class="mb-3">
						{msg.ballot_ballot_detail_recorded_vote_once_voting_closes()}
					</p>
				{/if}
				<Form remote={castBallotVote} successToast={msg.ballot_ballot_detail_vote_recorded()}>
					<input {...castBallotVote.fields.ballotId.as('hidden', b.id)} />
					<FormField
						field={castBallotVote.fields.optionId}
						type="select"
						label={msg.ballot_ballot_detail_choice()}
						placeholder={msg.ballot_ballot_detail_placeholder()}
						options={voteOptions}
						value={data.myVote?.optionId ?? ''}
					/>
					<SubmitButton
						label={data.myVote?.optionId
							? msg.ballot_ballot_detail_change_my_vote()
							: msg.ballot_ballot_detail_cast_my_vote()}
					/>
				</Form>
			{/if}
		</InfoCard>
	{/if}

	{#if data.tally}
		<InfoCard
			title={b.status === 'certified'
				? msg.ballot_ballot_detail_certified_result()
				: msg.ballot_ballot_detail_result()}
		>
			<Table>
				{#snippet head()}
					<th>{msg.ballot_ballot_detail_choice_2()}</th>
					<th class="cell-num">{msg.ballot_ballot_detail_votes()}</th>
					<th class="cell-num">{msg.ballot_ballot_detail_share()}</th>
				{/snippet}
				{#each data.tally.options as o (o.optionId)}
					<tr>
						<td class="cell-primary">{o.label}</td>
						<td class="cell-num">{o.votes}</td>
						<td class="cell-num">{share(o.votes, data.tally.turnout)}</td>
					</tr>
				{/each}
			</Table>
			<p class="mt-3 text-muted">
				{msg.ballot_ballot_detail_roll_voted({
					turnout: data.tally.turnout,
					electorateSize: data.tally.electorateSize
				})}
			</p>
		</InfoCard>

		{#if data.tally.rollCall}
			<InfoCard title={msg.ballot_ballot_detail_roll_call()}>
				{#if data.tally.rollCall.length === 0}
					<EmptyState title={msg.ballot_ballot_detail_nobody_voted()} />
				{:else}
					<Table>
						{#snippet head()}
							<th>{msg.ballot_ballot_detail_member()}</th>
							<th>{msg.ballot_ballot_detail_vote_2()}</th>
						{/snippet}
						{#each data.tally.rollCall as r (r.userId)}
							<tr>
								<td class="cell-primary">{r.name}</td>
								<td>{optionLabel.get(r.optionId) ?? '—'}</td>
							</tr>
						{/each}
					</Table>
				{/if}
			</InfoCard>
		{/if}
	{/if}

	<InfoCard title={msg.ballot_ballot_detail_details()}>
		<DefinitionList>
			<Fact label={msg.ballot_ballot_detail_status()}>
				<StatusBadge status={b.status} label text={ballotStatusLabels[b.status]} />
			</Fact>
			<Fact label={msg.ballot_ballot_detail_kind()} value={ballotKindLabels[b.kind]} />
			{#if b.group}
				<Fact label={msg.ballot_ballot_detail_committee()} value={b.group.name} />
			{/if}
			<Fact
				label={msg.ballot_ballot_detail_choices()}
				value={b.options.map((o) => o.label).join(' · ')}
			/>
			<Fact label={msg.ballot_ballot_detail_closes()} value={formatDateTime(b.closesAt)} />
			<Fact
				label={msg.ballot_ballot_detail_certifier()}
				value={b.certifier?.name ?? 'Nobody named yet'}
			/>
			{#if b.status === 'draft' && data.previewSize !== null}
				<Fact
					label={msg.ballot_ballot_detail_roll_if_opened_now()}
					value={String(data.previewSize)}
				/>
			{:else if b.electorateSize !== null}
				<Fact label={msg.ballot_ballot_detail_roll()} value={String(b.electorateSize)} />
			{/if}
			{#if data.turnout}
				<Fact
					label={msg.ballot_ballot_detail_voted_so_far()}
					value={`${data.turnout.voted} of ${data.turnout.electorateSize}`}
				/>
			{/if}
		</DefinitionList>
	</InfoCard>

	{#if data.overrides && (b.status === 'draft' || b.status === 'open' || data.overrides.length > 0)}
		<InfoCard title={msg.ballot_ballot_detail_roll_overrides()}>
			<p class="mb-3 text-muted">
				{msg.ballot_ballot_detail_put_member_roll_rule_leaves()}
			</p>
			{#if data.overrides.length > 0}
				<Table>
					{#snippet head()}
						<th>{msg.ballot_ballot_detail_member()}</th>
						<th>{msg.ballot_ballot_detail_override()}</th>
						<th>{msg.ballot_ballot_detail_reason()}</th>
					{/snippet}
					{#each data.overrides as o (o.userId)}
						<tr>
							<td class="cell-primary">{o.name}</td>
							<td class="whitespace-nowrap"
								>{o.include
									? msg.ballot_ballot_detail_added()
									: msg.ballot_ballot_detail_removed()}</td
							>
							<td>{o.reason}</td>
						</tr>
					{/each}
				</Table>
			{/if}
			{#if b.status === 'draft' || b.status === 'open'}
				<div class="mt-3">
					<Action
						action={setElectorOverrideForm}
						label={msg.ballot_ballot_detail_override_roll()}
						modalTitle={msg.ballot_ballot_detail_override_roll()}
						submitLabel={msg.ballot_ballot_detail_save()}
						successToast={msg.ballot_ballot_detail_roll_updated()}
						variant="ghost"
						size="sm"
					>
						{#snippet form()}
							<input {...setElectorOverrideForm.fields.ballotId.as('hidden', b.id)} />
							<MemberPicker
								field={setElectorOverrideForm.fields.userId}
								bind:value={overrideUserId}
								bind:name={overrideUserName}
							/>
							<FormField
								field={setElectorOverrideForm.fields.include}
								type="select"
								label={msg.ballot_ballot_detail_change()}
								options={[
									{ value: 'include', label: msg.ballot_ballot_detail_add_roll() },
									{ value: 'exclude', label: msg.ballot_ballot_detail_take_off_roll() }
								]}
							/>
							<FormField
								field={setElectorOverrideForm.fields.reason}
								type="textarea"
								label={msg.ballot_ballot_detail_why()}
							/>
						{/snippet}
					</Action>
				</div>
			{/if}
		</InfoCard>
	{/if}
</PageContent>
