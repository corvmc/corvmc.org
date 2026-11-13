<!-- Test harness: a form that a success replaces with its result message. -->
<script lang="ts">
	import Alert from '../Alert.svelte';
	import Form from './Form.svelte';
	import FormField from './FormField.svelte';

	let done = $state(false);
</script>

<div>
	{#if done}
		<Alert type="success">Sent</Alert>
	{:else}
		<Form action={() => Promise.resolve()} onsuccess={() => (done = true)}>
			<FormField name="first" label="First" />
		</Form>
	{/if}
</div>
