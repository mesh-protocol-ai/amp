/**
 * CloudEvents 1.0 + AMP extensions to serialize/parse control plane messages.
 */

export const AMP_VERSION = '0.1.0';

export const EVENT_TYPES = {
  CAPABILITY_REQUEST: 'amp.capability.request',
  CAPABILITY_BID: 'amp.capability.bid',
  CAPABILITY_MATCH: 'amp.capability.match',
  CAPABILITY_REJECT: 'amp.capability.reject',
} as const;

export interface AMPExtensions {
  ampversion?: string;
  correlationid?: string;
  sessionid?: string;
  traceid?: string;
  signature?: string;
}

export interface CloudEvent<T = unknown> {
  specversion: string;
  type: string;
  source: string;
  id: string;
  time?: string;
  datacontenttype?: string;
  data?: T;
  [key: string]: unknown;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Creates a CloudEvent with type, source, data, and AMP extensions.
 */
export function newCloudEvent<T>(
  eventType: string,
  source: string,
  data: T,
  ext: AMPExtensions = {}
): CloudEvent<T> {
  const extensions: Record<string, string> = {
    ampversion: ext.ampversion ?? AMP_VERSION,
  };
  if (ext.correlationid) extensions.correlationid = ext.correlationid;
  if (ext.sessionid) extensions.sessionid = ext.sessionid;
  if (ext.traceid) extensions.traceid = ext.traceid;
  if (ext.signature) extensions.signature = ext.signature;

  return {
    specversion: '1.0',
    type: eventType,
    source,
    id: randomId(),
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    ...extensions,
    data,
  };
}

/**
 * Serializes the event to JSON (to publish on NATS).
 */
export function serializeCloudEvent<T>(event: CloudEvent<T>): string {
  return JSON.stringify(event);
}

/**
 * Parses a CloudEvent from JSON.
 */
export function parseCloudEvent<T = unknown>(payload: string | Uint8Array): CloudEvent<T> {
  const raw = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  const parsed = JSON.parse(raw) as CloudEvent<T>;
  if (!parsed.specversion || !parsed.type || !parsed.source || !parsed.id) {
    throw new Error('Invalid CloudEvent: missing required fields');
  }
  return parsed;
}

/**
 * Reads AMP extensions from a parsed event.
 */
export function getAMPExtensions(event: CloudEvent): AMPExtensions {
  return {
    ampversion: String(event.ampversion ?? ''),
    correlationid: String(event.correlationid ?? ''),
    sessionid: String(event.sessionid ?? ''),
    traceid: String(event.traceid ?? ''),
    signature: String(event.signature ?? ''),
  };
}
