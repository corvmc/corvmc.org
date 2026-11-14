# Building access

Status: ✅ /staff/building-access

A Practice space view (#2766), with a Lock offline link in the Practice space header while the last health reading in KV says the lock is offline. The lock-offline email and the U-tec sign-in land here; `/staff/keys` and `/staff/reservations?access` redirect. Lock status and last seen; active codes in three groups (per-booking, key holders including adopted unassigned codes, break-glass with its rotation date), each by last two digits and on-lock or waiting; Lock settings (the U-tec card moved from Settings → Integrations: connection, lock health, last daily run, Test connection, Run self-test, Rotate break-glass code, credentials behind Reconnect). Recent usage waits on #2589. `lock.manage`; Lock settings also needs `settings.read`
