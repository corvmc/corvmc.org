<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import type { EpkContact } from '#lib/types/band-page.js';

	/**
	 * One named person a venue can reach.
	 *
	 * `contact` is bindable and may be undefined — a role nobody fills stays
	 * absent rather than becoming an object of empty strings, so
	 * `hasBookingContact()` and the completeness ladder can both read "did they
	 * answer this" straight off the shape.
	 */
	let {
		label,
		description,
		contact = $bindable(),
		withPhone = true
	}: {
		label: string;
		description: string;
		contact: EpkContact | undefined;
		withPhone?: boolean;
	} = $props();

	// Editing any field of an absent role brings it into being. Written as one
	// helper rather than three `oninput`s so the "create on first keystroke"
	// rule lives in one place.
	function set(patch: Partial<EpkContact>) {
		const next = { name: '', email: '', ...contact, ...patch };
		// An entirely blank role is the same as no role. Clearing the last
		// character of the last field removes it, which is how a band un-names
		// someone who left.
		contact = next.name || next.email || next.phone ? next : undefined;
	}
</script>

<fieldset class="space-y-3">
	<legend class="text-sm font-semibold">{label}</legend>
	<p class="text-muted text-sm">{description}</p>

	<FormField
		type="text"
		label={m.band_name()}
		value={contact?.name ?? ''}
		oninput={(e: Event) => set({ name: (e.currentTarget as HTMLInputElement).value })}
	/>
	<FormField
		type="email"
		label={m.band_email()}
		value={contact?.email ?? ''}
		oninput={(e: Event) => set({ email: (e.currentTarget as HTMLInputElement).value })}
	/>
	{#if withPhone}
		<FormField
			type="tel"
			label={m.band_phone()}
			description={m.band_slug_press_kit_contact_role_fields_description()}
			value={contact?.phone ?? ''}
			oninput={(e: Event) =>
				set({ phone: (e.currentTarget as HTMLInputElement).value || undefined })}
		/>
	{/if}
</fieldset>
