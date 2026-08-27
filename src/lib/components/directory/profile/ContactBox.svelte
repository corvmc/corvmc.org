<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import { IconMail, IconPhone, IconAt } from '@tabler/icons-svelte';
	import type { DirectoryContact } from '$lib/server/db/schema/authentication';

	let {
		label,
		contact
	}: {
		label: 'Contact' | 'Booking';
		contact: DirectoryContact | null | undefined;
	} = $props();

	const c = $derived(contact ?? {});
	const hasAny = $derived(!!c.email || !!c.phone || !!c.social);
	// Booking contact is always public; personal contact reflects the member's
	// own opt-in (members-only by default).
	const note = $derived<'public' | 'members-only'>(
		label === 'Booking' || c.visibility === 'public' ? 'public' : 'members-only'
	);
</script>

{#if hasAny}
	<ProfileSection title={label} {note}>
		<div class="contact">
			{#if c.email}
				<a href="mailto:{c.email}" class="contact__row">
					<IconMail size={16} />
					<span>{c.email}</span>
				</a>
			{/if}
			{#if c.phone}
				<a href="tel:{c.phone}" class="contact__row">
					<IconPhone size={16} />
					<span>{c.phone}</span>
				</a>
			{/if}
			{#if c.social}
				<span class="contact__row">
					<IconAt size={16} />
					<span>{c.social}</span>
				</span>
			{/if}
		</div>
	</ProfileSection>
{/if}

<style>
	.contact {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.contact__row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--fg-1);
		text-decoration: none;
	}
	a.contact__row:hover {
		color: var(--color-primary);
	}
</style>
