# Email unsubscribe

Status: ✅ /unsubscribe/[token]

HMAC-signed unsubscribe. The GET page **confirms** (`getUnsubscribeInfo` is read-only; `confirmUnsubscribe` performs the write on POST) so link-prefetching mail clients and URL scanners can't unsubscribe someone who never clicked. The RFC 8058 one-click POST handler in `+page.server.ts` is unchanged.
