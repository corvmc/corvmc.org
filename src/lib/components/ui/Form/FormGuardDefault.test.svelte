<!-- Test harness: a `<Form>` that says nothing about `guard`. -->
<script lang="ts">
	import Form from './Form.svelte';
	import FormField from './FormField.svelte';
</script>

<Form action={() => Promise.resolve()}>
	<FormField name="title" label="Title" />
</Form>
