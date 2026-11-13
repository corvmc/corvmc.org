<!--
	Test harness for Form's focus handling: two fields and a submit, with the
	second field marked invalid the way a remote field marks it.
-->
<script lang="ts">
	import Form from './Form.svelte';
	import FormField from './FormField.svelte';
	import SubmitButton from './SubmitButton.svelte';

	let { action }: { action: (data: FormData) => Promise<void> } = $props();
</script>

<Form {action} flashDuration={20}>
	<FormField name="first" label="First" />
	<FormField name="second" label="Second" aria-invalid="true" />
	<SubmitButton />
</Form>
