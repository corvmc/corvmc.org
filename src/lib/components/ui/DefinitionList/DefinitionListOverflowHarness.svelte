<script lang="ts">
	import DefinitionList from './DefinitionList.svelte';
	import Fact from './Fact.svelte';
</script>

<div style="width: 320px">
	<DefinitionList>
		<Fact label="Roles">
			<span style="white-space: nowrap">
				Audio Engineering · Door · Gear Repair · Host · Merch · Photo/Video · Tech
			</span>
		</Fact>
		<Fact label="Availability" wrap>
			Schedule is pretty flexible. Sometimes I can't do some weekends but I let staff know early
			enough.
		</Fact>
	</DefinitionList>
</div>
