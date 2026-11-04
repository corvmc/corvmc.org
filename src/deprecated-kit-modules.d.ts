// Kit 3 still serves `$env/dynamic/*` and `$app/environment` but ships no types
// for them. These restate kit 2's until the call sites move to `$app/env` (#2202).
// What `env` actually holds is whatever src/env.ts declares; see src/env.spec.ts.

declare module '$env/dynamic/private' {
	export const env: {
		[key: `PUBLIC_${string}`]: undefined;
		[key: string]: string | undefined;
	};
}

declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	};
}

declare module '$app/environment' {
	export * from '$app/env';
}
