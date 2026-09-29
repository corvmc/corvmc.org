<script lang="ts">
	/**
	 * One ballot, for everyone who can see it: the vote for an elector, the
	 * result once it may be read, and the draft controls for its managers.
	 * Mounted by `/member/ballots/[id]` and `/staff/ballots/[id]`.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { startProjectFromBallotForm } from '$lib/remote/projects.remote';
	import { ballotKindLabels, ballotStatusLabels, DEFAULT_TIMEZONE } from '$lib/config';
	import { formatDateTime, formatDateShortYear } from '$lib/utils/format';
	import {
		cancelBallotForm,
		castBallotVote,
		certifyBallotForm,
		changeBallotCertifier,
		openBallotForm,
		setElectorOverrideForm,
		updateBallotDraft,
		type getBallotPage
	} from '$lib/remote/ballots.remote';

	type Page = Awaited<ReturnType<typeof getBallotPage>>;

	let { data, backHref, panel }: { data: Page; backHref: string; panel: 'member' | 'staff' } =
		$props();

	// Above anything async-gated, as on the staff suggestion page.
	const startFields = startProjectFromBallotForm.fields;

	const b = $derived(data.ballot);
	const viewer = $derived(data.viewer);
	const secret = $derived(b.kind === 'member');
	const optionLabel = $derived(new Map(b.options.map((o) => [o.id, o.label])));
	const voteOptions = $derived(b.options.map((o) => ({ value: o.id, label: o.label })));
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
				? resolve(`/staff/suggestions/${decides.suggestion.id}`)
				: resolve(`/member/suggestions/${decides.suggestion.id}`)
			: null
	);
	const projectHref = (id: string) =>
		viewer.canReadProjects ? resolve(`/staff/projects/${id}`) : null;

	function share(votes: number, turnout: number) {
		return turnout === 0 ? '—' : `${Math.round((votes / turnout) * 100)}%`;
	}
</script>

<PageHeader
	title={b.title}
	subtitle={b.group?.name ?? ballotKindLabels[b.kind]}
	{backHref}
	width="3xl"
>
	{#if viewer.isManager && b.status === 'draft'}
		<Action
			action={updateBallotDraft}
			label="Edit"
			modalTitle="Edit the draft"
			submitLabel="Save"
			successToast="Draft saved"
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...updateBallotDraft.fields.ballotId.as('hidden', b.id)} />
				<FormField
					field={updateBallotDraft.fields.title}
					type="text"
					label="Question"
					value={b.title}
				/>
				<FormField
					field={updateBallotDraft.fields.description}
					type="textarea"
					label="Background (optional)"
					value={b.description ?? ''}
				/>
				<FormField
					field={updateBallotDraft.fields.options}
					type="textarea"
					label="Choices"
					description="One per line, between 2 and 10."
					value={b.options.map((o) => o.label).join('\n')}
				/>
				<FormField
					field={updateBallotDraft.fields.closesOn}
					type="date"
					label="Voting closes at the end of"
					value={closesOn}
				/>
				{#if b.kind === 'group'}
					<FormField
						field={updateBallotDraft.fields.certifierId}
						type="select"
						label="Certifier"
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
			label="Open voting"
			modalTitle="Open voting"
			submitLabel="Open"
			successToast="Voting is open"
			size="sm"
		>
			{#snippet form()}
				<input {...openBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p>
					Opening freezes the roll: {data.previewSize ?? 0}
					{data.previewSize === 1 ? 'person' : 'people'} can vote, and nobody can be added by joining,
					reaching the membership age or finishing orientation later. The question and choices can no
					longer be edited, and everyone on the roll is notified.
				</p>
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isManager && (b.status === 'open' || b.status === 'closed')}
		<Action
			action={changeBallotCertifier}
			label="Change certifier"
			modalTitle="Change the certifier"
			submitLabel="Save"
			successToast="Certifier changed"
			variant="ghost"
			size="sm"
		>
			{#snippet form()}
				<input {...changeBallotCertifier.fields.ballotId.as('hidden', b.id)} />
				{#if b.kind === 'group'}
					<FormField
						field={changeBallotCertifier.fields.certifierId}
						type="select"
						label="Certifier"
						options={certifierOptions}
						value={b.certifier?.id ?? ''}
					/>
				{:else}
					<MemberPicker
						field={changeBallotCertifier.fields.certifierId}
						label="Certifier"
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
			label="Cancel ballot"
			modalTitle="Cancel this ballot"
			submitLabel="Cancel ballot"
			submitVariant="error"
			successToast="Ballot cancelled"
			variant="error"
			outline
			size="sm"
		>
			{#snippet form()}
				<input {...cancelBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p class="mb-3">
					Cancelling is final. No result is ever shown for a cancelled ballot, including votes
					already cast.
				</p>
				<FormField field={cancelBallotForm.fields.reason} type="textarea" label="Why" />
			{/snippet}
		</Action>
	{/if}
	{#if viewer.isCertifier && b.status === 'closed'}
		<Action
			action={certifyBallotForm}
			label="Certify the result"
			modalTitle="Certify the result"
			submitLabel="Certify"
			successToast="Result certified and published"
			size="sm"
		>
			{#snippet form()}
				<input {...certifyBallotForm.fields.ballotId.as('hidden', b.id)} />
				<p>
					Certifying fixes the result below as the official one and publishes it to every member. It
					cannot be undone.
				</p>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	{#if decides.suggestion || decides.project || data.authorised || data.startProject}
		<InfoCard title="What this decides">
			<DefinitionList>
				{#if decides.suggestion}
					<Fact label="Suggestion">
						<a class="link" href={suggestionHref}>{decides.suggestion.title}</a>
						<StatusBadge status={decides.suggestion.status} label />
					</Fact>
				{/if}
				{#if decides.project}
					{@const href = projectHref(decides.project.id)}
					<Fact label="Project">
						{#if href}<a class="link" {href}>{decides.project.name}</a>{:else}{decides.project
								.name}{/if}
					</Fact>
				{/if}
				{#if data.passed !== null}
					<Fact label="Outcome" value={data.passed ? 'Passed' : 'Did not pass'} />
				{/if}
				{#if data.authorised}
					{@const href = projectHref(data.authorised.id)}
					<Fact label="Became the project">
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
						label="Start project"
						modalTitle="Start the project this ballot authorised"
						submitLabel="Start"
						successToast="Project started"
						variant="primary"
						size="sm"
						onsuccess={(r) => {
							if (r && typeof r === 'object' && 'id' in r) {
								void goto(resolve(`/staff/projects/${r.id as string}`));
							}
						}}
					>
						{#snippet form()}
							<input {...startFields.ballotId.as('hidden', b.id)} />
							<p class="mb-3 text-muted">
								The project is linked to this ballot{decides.suggestion
									? ' and to the suggestion it decided, which moves to Planned with it'
									: ''}.
							</p>
							<Field field={startFields.name} type="text" label="Project name" value={start.name} />
							<Field
								field={startFields.groupId}
								type="select"
								label="Owning committee"
								options={start.committees.map((c) => ({ value: c.id, label: c.name }))}
								description="Only a committee can own a project. Leave blank to decide later."
							/>
							<MoneyField field={startFields.budgetCents} label="Budget" />
						{/snippet}
					</Action>
				</div>
			{/if}
		</InfoCard>
	{/if}

	{#if b.status === 'cancelled'}
		<Alert type="warning">This ballot was cancelled: {b.cancelReason}</Alert>
	{:else if b.status === 'certified' && b.certifiedAt}
		<Alert type="success">
			Certified by {b.certifier?.name ?? 'the certifier'} on {formatDateShortYear(b.certifiedAt)}.
		</Alert>
	{:else if b.status === 'closed'}
		<Alert type="info">
			Voting has closed.
			{viewer.isCertifier
				? 'You are the certifier: check the result below and certify it.'
				: `The result is waiting for ${b.certifier?.name ?? 'the certifier'} to certify it.`}
		</Alert>
	{/if}

	{#if b.description}
		<InfoCard title="Background">
			<p class="whitespace-pre-wrap">{b.description}</p>
		</InfoCard>
	{/if}

	{#if viewer.isElector && b.status === 'open'}
		<InfoCard title="Your vote">
			{#if secret && data.myVote?.voted}
				<p>
					Your vote is in. It is secret: the app records that you voted and adds one to your
					choice's count, with nothing linking the two, so nobody can see how you voted. It cannot
					be changed.
				</p>
			{:else}
				{#if data.myVote?.optionId}
					<p class="mb-3">
						You voted <strong>{optionLabel.get(data.myVote.optionId)}</strong>. This is a recorded
						vote: you can change it until voting closes, and after that it appears in the roll call.
					</p>
				{:else if secret}
					<p class="mb-3">
						This is a secret ballot. Nobody will be able to see how you voted, and you cannot change
						your vote once it is cast.
					</p>
				{:else}
					<p class="mb-3">
						This is a recorded vote: once voting closes, who voted which way appears beside the
						result. You can change your vote until then.
					</p>
				{/if}
				<Form remote={castBallotVote} successToast="Vote recorded">
					<input {...castBallotVote.fields.ballotId.as('hidden', b.id)} />
					<FormField
						field={castBallotVote.fields.optionId}
						type="select"
						label="Your choice"
						placeholder="Choose one"
						options={voteOptions}
						value={data.myVote?.optionId ?? ''}
					/>
					<SubmitButton label={data.myVote?.optionId ? 'Change my vote' : 'Cast my vote'} />
				</Form>
			{/if}
		</InfoCard>
	{/if}

	{#if data.tally}
		<InfoCard title={b.status === 'certified' ? 'Certified result' : 'Result'}>
			<Table>
				{#snippet head()}
					<th>Choice</th>
					<th class="cell-num">Votes</th>
					<th class="cell-num">Share</th>
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
				{data.tally.turnout} of {data.tally.electorateSize} on the roll voted.
			</p>
		</InfoCard>

		{#if data.tally.rollCall}
			<InfoCard title="Roll call">
				{#if data.tally.rollCall.length === 0}
					<EmptyState title="Nobody voted" />
				{:else}
					<Table>
						{#snippet head()}
							<th>Member</th>
							<th>Vote</th>
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

	<InfoCard title="Details">
		<DefinitionList>
			<Fact label="Status">
				<StatusBadge status={b.status} label text={ballotStatusLabels[b.status]} />
			</Fact>
			<Fact label="Kind" value={ballotKindLabels[b.kind]} />
			{#if b.group}
				<Fact label="Committee" value={b.group.name} />
			{/if}
			<Fact label="Choices" value={b.options.map((o) => o.label).join(' · ')} />
			<Fact label="Closes" value={formatDateTime(b.closesAt)} />
			<Fact label="Certifier" value={b.certifier?.name ?? 'Nobody named yet'} />
			{#if b.status === 'draft' && data.previewSize !== null}
				<Fact label="Roll if opened now" value={String(data.previewSize)} />
			{:else if b.electorateSize !== null}
				<Fact label="On the roll" value={String(b.electorateSize)} />
			{/if}
			{#if data.turnout}
				<Fact
					label="Voted so far"
					value={`${data.turnout.voted} of ${data.turnout.electorateSize}`}
				/>
			{/if}
		</DefinitionList>
	</InfoCard>

	{#if data.overrides && (b.status === 'draft' || b.status === 'open' || data.overrides.length > 0)}
		<InfoCard title="Roll overrides">
			<p class="mb-3 text-muted">
				Put a member on the roll the rule leaves off, or take someone off it. Each change is
				recorded in the audit log with its reason. Nobody who has already voted can be taken off.
			</p>
			{#if data.overrides.length > 0}
				<Table>
					{#snippet head()}
						<th>Member</th>
						<th>Override</th>
						<th>Reason</th>
					{/snippet}
					{#each data.overrides as o (o.userId)}
						<tr>
							<td class="cell-primary">{o.name}</td>
							<td class="whitespace-nowrap">{o.include ? 'Added' : 'Removed'}</td>
							<td>{o.reason}</td>
						</tr>
					{/each}
				</Table>
			{/if}
			{#if b.status === 'draft' || b.status === 'open'}
				<div class="mt-3">
					<Action
						action={setElectorOverrideForm}
						label="Override the roll"
						modalTitle="Override the roll"
						submitLabel="Save"
						successToast="Roll updated"
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
								label="Change"
								options={[
									{ value: 'include', label: 'Add to the roll' },
									{ value: 'exclude', label: 'Take off the roll' }
								]}
							/>
							<FormField field={setElectorOverrideForm.fields.reason} type="textarea" label="Why" />
						{/snippet}
					</Action>
				</div>
			{/if}
		</InfoCard>
	{/if}
</PageContent>
