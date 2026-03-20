/**
 * Resolves a NATS server URL from an optional raw string.
 *
 * Handles the following input forms:
 *   - ""           → nats://<defaultHost>:<defaultPort>
 *   - "nats://h.o.s.t:4222"  → nats://h.o.s.t:4222
 *   - "h.o.s.t:4222"         → nats://h.o.s.t:4222
 *   - "h.o.s.t"             → nats://h.o.s.t:<defaultPort>
 *
 * Dot-less hostnames (e.g. "localhost") are intentionally left as the
 * caller's responsibility — pass the full "nats://localhost:4222" form.
 */

export interface ResolveNatsUrlOptions {
  /** Fallback hostname when the raw value is empty or unresolvable. Defaults to "localhost". */
  defaultHost?: string;
  /** Fallback port when the raw value doesn't specify one. Defaults to "4222". */
  defaultPort?: string;
}

export function resolveNatsUrl(
  raw: string | undefined,
  options: ResolveNatsUrlOptions = {},
): string {
  const defaultHost = options.defaultHost ?? 'localhost';
  const defaultPort = options.defaultPort ?? '4222';

  const value = (raw ?? '').trim();
  let host = defaultHost;
  let port = defaultPort;

  if (value.startsWith('nats://')) {
    try {
      const u = new URL(value);
      if (u.hostname && u.hostname.includes('.')) {
        host = u.hostname;
        port = u.port || defaultPort;
      }
      return `nats://${host}:${port}`;
    } catch (_) {
      // fall through to default
    }
  }

  if (value.includes('.')) {
    const [h, p] = value.split(':');
    if (h) host = h;
    if (p && /^\d+$/.test(p)) port = p;
  }

  return `nats://${host}:${port}`;
}
