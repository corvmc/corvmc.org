<script lang="ts">
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { reportAssetDamage } from '$lib/remote/inventory.remote';
	import { Field } from '../ui/Form';

	const { fields } = reportAssetDamage;

	let {
		assetId,
		variant = 'default',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		assetId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={reportAssetDamage}
	label="Report a problem"
	modalTitle="Report a problem"
	successToast="Thanks — staff have been told"
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => invalidateAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.assetId.as('hidden', assetId)} />
		<!-- Said plainly, because it is a real consequence of pressing the button:
		     the unit stops being bookable straight away. Better that than the next
		     member finding out the hard way. -->
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>This takes the item out of service until staff have looked at it.</p>
		</div>
		<Field
			field={fields.note}
			type="textarea"
			label="What's wrong?"
			description="Whatever you noticed is enough — staff will follow up."
		/>
		<Field
			field={fields.condition}
			type="select"
			label="How bad is it?"
			options={[
				{ value: '', label: 'Not sure' },
				{ value: 'fair', label: 'Still usable, but not right' },
				{ value: 'poor', label: 'Should not be used' }
			]}
		/>
	{/snippet}
</Action>
