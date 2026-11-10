import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Every variable the app reads through `$app/env/*`. Kit exposes only the
 * variables declared here, and types those modules from this list, so reading an
 * undeclared name fails `pnpm check`. Every one is optional.
 */
const optional = { schema: (value: string | undefined) => value };
const optionalPublic = { ...optional, public: true };

export const variables = defineEnvVars({
	BETTER_AUTH_SECRET: optional,
	BOOKING_CONTACT_EMAIL: optional,
	CLOUDFLARE_API_TOKEN: optional,
	CLOUDFLARE_ZONE_ID: optional,
	CRON_SECRET: optional,
	EMAIL_FROM_ADDRESS: optional,
	EMAIL_FROM_NAME: optional,
	INBOX_REPLY_ADDRESS: optional,
	INBOX_REPLY_SECRET: optional,
	LARAVEL_URL: optional,
	LEDGER_RECONCILE_THRESHOLD_CENTS: optional,
	MARKETING_UNSUBSCRIBE_SECRET: optional,
	META_APP_SECRET: optional,
	META_PAGE_ACCESS_TOKEN: optional,
	META_VERIFY_TOKEN: optional,
	MIGRATION_SECRET: optional,
	ORIGIN: optional,
	PAYMENTS_DRIVER: optional,
	POSTMARK_BROADCAST_STREAM: optional,
	POSTMARK_INBOUND_TOKEN: optional,
	POSTMARK_SERVER_TOKEN: optional,
	POSTMARK_TRANSACTIONAL_STREAM: optional,
	POSTMARK_WEBHOOK_TOKEN: optional,
	R2_PUBLIC_URL: optional,
	R2_TRANSFORM_SOURCE_ABSOLUTE: optional,
	R2_TRANSFORM_URL: optional,
	STAFF_CONTACT_EMAIL: optional,
	STRIPE_CONNECT_WEBHOOK_SECRET: optional,
	STRIPE_SECRET_KEY: optional,
	STRIPE_TERMINAL_LOCATION_ID: optional,
	STRIPE_TERMINAL_READER_ID: optional,
	STRIPE_WEBHOOK_SECRET: optional,
	TURNSTILE_SECRET_KEY: optional,
	TWILIO_ACCOUNT_SID: optional,
	TWILIO_AUTH_TOKEN: optional,
	TWILIO_PHONE_NUMBER: optional,
	ULTRALOC_CLIENT_ID: optional,
	ULTRALOC_CLIENT_SECRET: optional,
	ULTRALOC_DEVICE_ID: optional,
	ULTRALOC_REFRESH_TOKEN: optional,

	PUBLIC_SENTRY_ENVIRONMENT: optionalPublic,
	PUBLIC_SITE_URL: optionalPublic,
	PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalPublic,
	PUBLIC_TURNSTILE_SITE_KEY: optionalPublic
});
