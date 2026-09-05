/**
 * sync-webhooks.ts
 *
 * Ensures the Stripe webhook endpoint is subscribed to exactly the events
 * declared in src/lib/server/finance/webhook-handlers.ts.
 *
 * Usage:
 *   pnpm tsx scripts/sync-webhooks.ts [--endpoint-id we_xxx]
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY   — required
 *   STRIPE_WEBHOOK_ID   — the webhook endpoint to update (or pass --endpoint-id)
 *   APP_URL             — base URL for creating a new endpoint (e.g. https://example.com)
 *
 * Behavior:
 *   - If an endpoint ID is provided, updates its enabled_events to match the registry.
 *   - If no endpoint ID is provided but APP_URL is set, creates a new endpoint.
 *   - Prints a diff of added/removed events when updating.
 */

import 'dotenv/config';
import Stripe from 'stripe';
import { registeredEvents } from '../src/lib/server/finance/webhook-events.js';

const WEBHOOK_PATH = '/api/stripe/webhook';

function getStripe(): Stripe {
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		console.error('Error: STRIPE_SECRET_KEY is not set');
		process.exit(1);
	}
	return new Stripe(key);
}

function parseArgs(): { endpointId?: string } {
	const args = process.argv.slice(2);
	const idx = args.indexOf('--endpoint-id');
	if (idx !== -1 && args[idx + 1]) {
		return { endpointId: args[idx + 1] };
	}
	return { endpointId: process.env.STRIPE_WEBHOOK_ID };
}

async function main() {
	const stripe = getStripe();
	const { endpointId } = parseArgs();

	console.log(`Registered events (${registeredEvents.length}):`);
	for (const event of registeredEvents) {
		console.log(`  • ${event}`);
	}
	console.log();

	if (endpointId) {
		await updateEndpoint(stripe, endpointId);
	} else if (process.env.APP_URL) {
		await createEndpoint(stripe);
	} else {
		console.log('No endpoint ID or APP_URL provided.');
		console.log('To update: pass --endpoint-id we_xxx or set STRIPE_WEBHOOK_ID');
		console.log('To create: set APP_URL');
		process.exit(1);
	}
}

async function updateEndpoint(stripe: Stripe, endpointId: string) {
	const endpoint = await stripe.webhookEndpoints.retrieve(endpointId);
	const current = new Set<string>(endpoint.enabled_events);
	const desired = new Set<string>(registeredEvents);

	const added = registeredEvents.filter((e) => !current.has(e));
	const removed = [...current].filter((e) => !desired.has(e) && e !== '*');

	if (added.length === 0 && removed.length === 0) {
		console.log(`✓ Endpoint ${endpointId} is already in sync.`);
		return;
	}

	if (added.length > 0) {
		console.log('Adding events:');
		for (const e of added) console.log(`  + ${e}`);
	}
	if (removed.length > 0) {
		console.log('Removing events:');
		for (const e of removed) console.log(`  - ${e}`);
	}

	await stripe.webhookEndpoints.update(endpointId, {
		enabled_events: registeredEvents as unknown as Stripe.WebhookEndpointUpdateParams.EnabledEvent[]
	});

	console.log(`\n✓ Updated endpoint ${endpointId}.`);
}

async function createEndpoint(stripe: Stripe) {
	const url = `${process.env.APP_URL}${WEBHOOK_PATH}`;
	console.log(`Creating webhook endpoint: ${url}`);

	const endpoint = await stripe.webhookEndpoints.create({
		url,
		enabled_events:
			registeredEvents as unknown as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
		description: 'corvmc-svelte webhook (managed by sync-webhooks script)'
	});

	console.log(`\n✓ Created endpoint ${endpoint.id}`);
	console.log(`  Secret: ${endpoint.secret}`);
	console.log(`\n  Add to .env: STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
	console.log(`               STRIPE_WEBHOOK_ID=${endpoint.id}`);
}

main().catch((err) => {
	console.error('Fatal:', err.message);
	process.exit(1);
});
