<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Form, { Field } from '#lib/components/ui/Form/index.js';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { searchBandUsers, inviteSeveral } from '#lib/remote/bands.remote.js';
	import {
		addRecipient,
		looksLikeEmail,
		recipientKey,
		resolveTyped,
		unsent,
		type Recipient,
		type SearchHit
	} from './invite-recipients';

	let {
		open = $bindable(false),
		bandId,
		onsent
	}: { open?: boolean; bandId: string; onsent: () => void } = $props();

	const { fields } = inviteSeveral;

	let typed = $state('');
	let hits = $state<SearchHit[]>([]);
	let searching = $state(false);
	let recipients = $state<Recipient[]>([]);
	let reasons = $state<Record<string, string | undefined>>({});
	let showUnresolved = $state(false);
	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Text left in the box still goes out when it stands for one person, so a
	// typed address or a unique name never needs a second step before sending.
	const pendingTyped = $derived(resolveTyped(typed, hits));
	const toSend = $derived(pendingTyped ? addRecipient(recipients, pendingTyped) : recipients);
	const memberIds = $derived(toSend.flatMap((r) => (r.kind === 'member' ? [r.id] : [])));
	const emails = $derived(toSend.flatMap((r) => (r.kind === 'email' ? [r.email] : [])));
	const emailOnly = $derived(
		looksLikeEmail(typed) && !hits.some((h) => h.email.toLowerCase() === typed.trim().toLowerCase())
	);

	async function search(q: string) {
		const mine = ++seq;
		if (q.trim().length < 2 || looksLikeEmail(q)) {
			hits = [];
			searching = false;
			return;
		}
		searching = true;
		const found = await searchBandUsers({ bandId, q }).catch(() => []);
		if (mine !== seq) return;
		hits = found;
		searching = false;
	}

	function onInput(e: Event) {
		typed = (e.target as HTMLInputElement).value;
		showUnresolved = false;
		clearTimeout(timer);
		timer = setTimeout(() => search(typed), 300);
	}

	function add(r: Recipient) {
		recipients = addRecipient(recipients, r);
		typed = '';
		hits = [];
		seq++;
		showUnresolved = false;
	}

	function remove(r: Recipient) {
		recipients = recipients.filter((x) => recipientKey(x) !== recipientKey(r));
	}

	// Enter adds what the text stands for instead of submitting; with nothing
	// typed it submits as usual.
	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' || !typed.trim()) return;
		e.preventDefault();
		if (pendingTyped) add(pendingTyped);
		else showUnresolved = true;
	}

	function reset() {
		clearTimeout(timer);
		seq++;
		typed = '';
		hits = [];
		searching = false;
		recipients = [];
		reasons = {};
		showUnresolved = false;
		fields.set({});
	}

	onDestroy(() => clearTimeout(timer));

	function label(r: Recipient) {
		return r.kind === 'member' ? r.name : r.email;
	}
</script>

<Modal title={msg.band_slug_members_invite_members_title()} bind:open onclose={reset}>
	<Form
		remote={inviteSeveral}
		onsuccess={(result) => {
			const outcomes = result?.outcomes ?? [];
			const left = unsent(toSend, outcomes);
			if (outcomes.some((o) => o.sent)) {
				toast.success(msg.band_slug_members_invitations_sent_toast());
				onsent();
			}
			if (left.length === 0) {
				open = false;
				reset();
				return;
			}
			recipients = left.map((l) => l.recipient);
			reasons = Object.fromEntries(left.map((l) => [recipientKey(l.recipient), l.reason]));
			typed = '';
			hits = [];
		}}
	>
		<div class="space-y-4">
			<input {...fields.bandId.as('hidden', bandId)} />
			{#each memberIds as id, i (id)}
				<input {...fields.userIds[i].as('hidden', id)} />
			{/each}
			{#each emails as email, i (email)}
				<input {...fields.emails[i].as('hidden', email)} />
			{/each}

			<Field
				label={msg.band_slug_members_people_label()}
				id="invite-people"
				description={msg.band_slug_members_people_help_text()}
				issues={fields.userIds.issues()}
			>
				{#if recipients.length > 0}
					<ul class="mb-2 space-y-1" data-testid="invite-recipients">
						{#each recipients as r (recipientKey(r))}
							<li class="flex items-center justify-between gap-2 rounded bg-base-200 px-3 py-1">
								<span class="min-w-0">
									<span class="font-medium">{label(r)}</span>
									{#if r.kind === 'member'}
										<span class="text-subtle">{r.email}</span>
									{/if}
									{#if recipientKey(r) in reasons}
										<span class="block text-error">
											{reasons[recipientKey(r)] ?? msg.band_slug_members_not_sent_text()}
										</span>
									{/if}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="xs"
									shape="circle"
									aria-label={msg.band_slug_members_remove_recipient_label({ name: label(r) })}
									onclick={() => remove(r)}>✕</Button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<input
					id="invite-people"
					type="text"
					class="input w-full"
					placeholder={msg.band_slug_members_people_placeholder()}
					value={typed}
					oninput={onInput}
					onkeydown={onKeydown}
					autocomplete="off"
				/>
				{#if hits.length > 0 || emailOnly}
					<ul class="menu mt-1 max-h-48 w-full overflow-y-auto inset">
						{#each hits as hit (hit.id)}
							<li>
								<button type="button" onclick={() => add({ kind: 'member', ...hit })}>
									<span class="font-medium">{hit.name}</span>
									<span class="text-subtle">{hit.email}</span>
								</button>
							</li>
						{/each}
						{#if emailOnly}
							<li>
								<button
									type="button"
									onclick={() => add({ kind: 'email', email: typed.trim().toLowerCase() })}
								>
									{msg.band_slug_members_add_email_label({ email: typed.trim() })}
								</button>
							</li>
						{/if}
					</ul>
				{/if}
				{#if searching}
					<p class="mt-1 text-subtle">{msg.band_slug_members_searching_text()}</p>
				{:else if showUnresolved}
					<p class="mt-1 text-subtle" role="status">
						{hits.length > 1
							? msg.band_slug_members_pick_one_text()
							: msg.band_slug_members_no_match_text()}
					</p>
				{/if}
			</Field>

			<div class="grid grid-cols-2 gap-4">
				<Field
					label={msg.band_role_label()}
					field={fields.role}
					type="select"
					value="member"
					options={[
						{ value: 'member', label: msg.band_role_member_label() },
						{ value: 'admin', label: msg.band_admin_label() }
					]}
				/>
				<Field
					label={msg.band_slug_members_position_label()}
					field={fields.position}
					type="text"
					placeholder={msg.band_slug_members_e_g_guitar_placeholder()}
				/>
			</div>

			<div class="flex justify-end pt-2">
				<SubmitButton
					label={msg.band_slug_members_send_invitations_label()}
					successLabel={msg.band_slug_members_sent_label()}
					variant="primary"
				/>
			</div>
		</div>
	</Form>
</Modal>
