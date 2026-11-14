import { recordAuditEntry } from '#lib/server/audit/audit-service.js';
import { config, updateSiteConfigs } from './site-config-service';

/** Keys whose values never enter the audit log; the row lists the key alone. */
const SECRET_KEY = /secret|token|password/i;

type Entry = { key: string; value: string | number | boolean };

/**
 * A staff settings save: the write, then one `settings.changed` row naming the
 * keys that moved. Kept apart from `site-config-service`, which e2e fixtures
 * import outside SvelteKit and so cannot reach the audit writer's imports.
 */
export async function saveSettings(entries: Entry[]): Promise<void> {
	const before = await Promise.all(entries.map(({ key }) => config(key)));
	await updateSiteConfigs(entries);

	const moved = entries.flatMap((e, i) =>
		e.value === before[i] ? [] : [{ ...e, from: before[i] }]
	);
	if (moved.length === 0) return;
	const redacted = moved.filter((e) => SECRET_KEY.test(e.key)).map((e) => e.key);
	await recordAuditEntry({
		action: 'settings.changed',
		subject: { type: 'setting', id: moved[0].key.split('.')[0], label: null },
		details: {
			changes: moved
				.filter((e) => !SECRET_KEY.test(e.key))
				.map((e) => ({ key: e.key, from: e.from, to: e.value })),
			...(redacted.length ? { redacted } : {})
		}
	});
}
