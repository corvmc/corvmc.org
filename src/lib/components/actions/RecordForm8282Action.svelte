<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { recordForm8282 } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';

	const { fields } = recordForm8282;

	let {
		assetId,
		dueBy,
		variant = 'primary',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		assetId: string;
		dueBy?: Date | null;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={recordForm8282}
	label="Record 8282"
	modalTitle="Record what happened"
	successToast="Recorded"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.id.as('hidden', assetId)} />
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>
				This unit was donated and disposed of within three years, so the IRS may require Form 8282 —
				filed within 125 days of the disposal, with a copy to the donor{#if dueBy}, by
					<strong>{dueBy.toISOString().slice(0, 10)}</strong>{/if}.
			</p>
			<!-- The system cannot decide this. Whether it is reportable turns on
			     whether the donor filed a Form 8283 that CMC signed, which is a fact
			     about paperwork rather than about stock. -->
			<p class="mt-1 opacity-70">
				Record either that it was filed, or that no filing was needed and why. Check with whoever
				prepares the return if you are unsure — this note is the only record.
			</p>
		</div>
		<Field
			field={fields.note}
			type="textarea"
			label="What happened"
			description="e.g. “Filed 2026-09-02, copy posted to the donor” or “No 8283 was ever signed, so no filing due”."
		/>
	{/snippet}
</Action>
