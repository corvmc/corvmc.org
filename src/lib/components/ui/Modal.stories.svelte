<script module lang="ts">
	import Button from './Button.svelte';
	import type { ComponentProps } from 'svelte';
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Modal from './Modal.svelte';

	// `open` defaults to true so the dialog renders in the canvas for the audit.
	const { Story } = defineMeta({
		title: 'Shared/Modal',
		component: Modal,
		tags: ['autodocs']
	});
</script>

{#snippet template(args: Omit<ComponentProps<typeof Modal>, 'children'>)}
	<Modal {...args}>
		<p>Are you sure you want to cancel this reservation? This cannot be undone.</p>
		<div class="modal-action">
			<Button variant="ghost">Keep it</Button>
			<Button variant="error">Cancel reservation</Button>
		</div>
	</Modal>
{/snippet}

<Story name="Default" args={{ open: true, title: 'Confirm cancellation' }} {template} />
<Story name="Wide" args={{ open: true, title: 'Edit details', maxWidth: 'max-w-2xl' }} {template} />
