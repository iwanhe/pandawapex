import { createHmac, timingSafeEqual } from 'node:crypto';

// Session State Protection: HMAC over the values a URL or a form is allowed to set.
// Key = RPX_SECRET (server) + the session's random salt, so a checksum is useless in another session.

export function sign(secret: string, salt: Buffer, message: string): string {
   return createHmac('sha256', Buffer.concat([Buffer.from(secret), salt])).update(message).digest('base64url').slice(0, 32);
}

export function verify(secret: string, salt: Buffer, message: string, given: string | undefined): boolean {
   if (!given) return false;
   const expected = Buffer.from(sign(secret, salt, message));
   const got = Buffer.from(given);
   return expected.length === got.length && timingSafeEqual(expected, got);
}

export function safeEqual(a: string, b: string | undefined): boolean {
   if (b === undefined) return false;
   const x = Buffer.from(a), y = Buffer.from(b);
   return x.length === y.length && timingSafeEqual(x, y);
}

/** Canonical message for "set these items on this page, clear these pages". */
export function urlMessage(page: number, items: Record<string, string>, clear: string): string {
   const pairs = Object.keys(items).sort().map(k => `${k}=${items[k]}`).join('&');
   return `url|${page}|${clear}|${pairs}`;
}

/** Canonical message for protected (hidden / display-only) item values rendered into a form. */
export function itemsMessage(page: number, items: Record<string, string | null>): string {
   const pairs = Object.keys(items).sort().map(k => `${k}=${items[k] ?? ''}`).join('&');
   return `items|${page}|${pairs}`;
}
