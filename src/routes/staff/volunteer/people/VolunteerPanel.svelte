<script lang="ts">
	/**
	 * One roster row read whole (#1790): every role, the availability the table
	 * has no column for, contact, and the row's own action. The user record stays
	 * one link further — this is the volunteer's entry, not the whole account.
	 */
	import type { Snippet } from 'svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import BadgeList from '$lib/components/ui/BadgeList.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import DefinitionList, { Fact } from '$lib/components/ui/DefinitionList';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import { formatDate } from '$lib/utils/format';
	import { formatVolunteerHours } from '$lib/config';
	import { subline, type RosterRow } from './subline';

	let {
		volunteer,
		open = $bindable(false),
		action
	}: {
		volunteer: RosterRow;
		open?: boolean;
		/** The row's one action, rendered by the page that owns its remote forms. */
		action?: Snippet;
	} = $props();

	const href = $derived(withQuery(resolve(`/staff/users/${volunteer.userId}`), 'tab=volunteer'));
	const note = $derived(subline(volunteer));
</script>

<Modal bind:open title={volunteer.member.title} placement="end" maxWidth="max-w-md">
	<div class="space-y-6">
		<EntityIdentity
			ref={volunteer.member}
			size="md"
			link={false}
			email={volunteer.member.subtitle}
			phone={volunteer.phone}
		/>

		{#if note}
			<p class="{note.tone} text-sm">{note.text}</p>
		{/if}

		<DefinitionList>
			<Fact label="Status">
				<span class="flex flex-wrap items-center gap-1">
					<StatusBadge status={volunteer.status} label />
					{#if !volunteer.isAdult}
						<Badge variant="ghost" size="xs">Under 18</Badge>
					{/if}
				</span>
			</Fact>
			<Fact label="Followed Roles">
				{#if volunteer.roleNames.length > 0}
					<BadgeList items={volunteer.roleNames} wrap />
				{:else}
					<span class="text-subtle">None picked</span>
				{/if}
			</Fact>
			<Fact label="Availability" wrap>
				{#if volunteer.availability}
					{volunteer.availability}
				{:else}
					<span class="text-subtle">Not given</span>
				{/if}
			</Fact>
			<Fact label="Hours" value={formatVolunteerHours(volunteer.minutes)} />
			<Fact label="Since" value={formatDate(volunteer.since)} />
		</DefinitionList>

		<div class="flex flex-wrap items-center gap-2">
			{#if action}{@render action()}{/if}
			<Button {href} variant="ghost" size="sm">Open Record</Button>
		</div>
	</div>
</Modal>
