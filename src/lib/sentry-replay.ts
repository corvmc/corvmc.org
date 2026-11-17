// Only ever imported dynamically (hooks.client.ts): a module of its own is what
// lets the bundler put Replay in a chunk the app entry does not carry.
export { replayIntegration } from '@sentry/sveltekit';
