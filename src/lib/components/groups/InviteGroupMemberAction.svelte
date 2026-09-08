<script lang="ts">
	import { onDestroy } from 'svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import {
		inviteGroupByEmail,
		inviteGroupMember,
		searchGroupUsers
	} from '$lib/remote/groups.remote';

	/**
	 * The door an `invite_only` group did not have.
	 *
	 * Two triggers rather than a mode switch inside one modal: each `Action`
	 * owns its modal, so flipping between them would unmount the dialog the
	 * leader was typing in.
	 */
	let { slug, groupName, onchanged }: { slug: string; groupName: string; onchanged: () => void } =
		$props();

	const memberFields = inviteGroupMember.fields;
	const emailFields = inviteGroupByEmail.fields;

	let searchQuery = $state('');
	let results = $state<{ id: string; name: string; email: string }[]>([]);
	let selected = $state<{ id: string; name: string; email: string } | null>(null);
	let searching = $state(false);
	let debounce: ReturnType<typeof setTimeout>;

	const roleOptions = [
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
	];

	async function search() {
		if (searchQuery.trim().length < 2) {
			results = [];
			return;
		}
		searching = true;
		results = await searchGroupUsers({ slug, q: searchQuery }).catch(() => []);
		searching = false;
	}

	function onInput(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		selected = null;
		clearTimeout(debounce);
		debounce = setTimeout(search, 300);
	}

	function reset() {
		searchQuery = '';
		results = [];
		selected = null;
		onchanged();
	}

	onDestroy(() => clearTimeout(debounce));
</script>

<Action
	action={inviteGroupMember}
	label="Invite"
	aria-label={`Invite someone to ${groupName}`}
	modalTitle="Invite to {groupName}"
	submitLabel="Send invitation"
	successToast="Invitation sent"
	variant="primary"
	size="sm"
	onsuccess={reset}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...memberFields.slug.as('hidden', slug)} />
			<input {...memberFields.userId.as('hidden', selected?.id ?? '')} />

			<FormField
				label="Who"
				name="memberSearch"
				type="text"
				value={searchQuery}
				oninput={onInput}
				autocomplete="off"
				placeholder="Search members by name or email"
				description={selected ? `Inviting ${selected.name}` : 'Pick somebody from the results.'}
			/>

			{#if searching}
				<p class="text-subtle">Searching…</p>
			{:else if results.length > 0}
				<ul class="menu w-full rounded-box bg-base-200">
					{#each results as candidate (candidate.id)}
						<li>
							<button type="button" onclick={() => ((selected = candidate), (results = []))}>
								<span class="font-medium">{candidate.name}</span>
								<span class="text-subtle">{candidate.email}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if searchQuery.trim().length >= 2}
				<p class="text-subtle">
					Nobody with an account by that name. Invite them by email instead.
				</p>
			{/if}

			<FormField
				field={memberFields.role}
				type="select"
				label="Role"
				value="member"
				options={roleOptions}
			/>
			<FormField
				field={memberFields.position}
				type="text"
				label="Position"
				maxlength="100"
				placeholder="Optional"
			/>
		</div>
	{/snippet}
</Action>

<!-- Its own trigger, because somebody with no account has no row to search for
     — this writes a `group_invite` that resolves when they sign up. -->
<Action
	action={inviteGroupByEmail}
	label="Invite by email"
	aria-label={`Invite someone to ${groupName} by email`}
	modalTitle="Invite to {groupName} by email"
	submitLabel="Send invitation"
	successToast="Invitation sent"
	variant="default"
	size="sm"
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...emailFields.slug.as('hidden', slug)} />
			<FormField
				field={emailFields.email}
				type="email"
				label="Email"
				placeholder="them@example.com"
				description="They join the roster when they sign up with this address."
				required
			/>
			<FormField
				field={emailFields.role}
				type="select"
				label="Role"
				value="member"
				options={roleOptions}
			/>
			<FormField
				field={emailFields.position}
				type="text"
				label="Position"
				maxlength="100"
				placeholder="Optional"
			/>
		</div>
	{/snippet}
</Action>
