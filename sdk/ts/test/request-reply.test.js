import assert from 'assert';
import { test } from 'node:test';
import { MeshClient } from '../dist/index.js';

// Minimal fake NATS connection that implements request, subscribe and publish used by MeshClient.
class FakeMsg {
  constructor(data) { this.data = data; }
}

class FakeSub {
  constructor(subject, cb, registry) {
    this.subject = subject;
    this.cb = cb;
    this.registry = registry;
    this.registry[subject] = this.registry[subject] || [];
    this.registry[subject].push(cb);
  }
  unsubscribe() {
    const arr = this.registry[this.subject] || [];
    this.registry[this.subject] = arr.filter((c) => c !== this.cb);
    return Promise.resolve();
  }
}

class FakeNats {
  constructor() {
    this.registry = {};
  }
  async request(subject, data, opts) {
    // parse incoming cloud event to extract correlation id and source
    const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const ev = JSON.parse(raw);
    const reqId = ev.correlationid || ev.id;
    const source = ev.source;

    // craft match CloudEvent
    const match = {
      specversion: '1.0',
      type: 'amp.capability.match',
      source: 'did:mesh:broker:local',
      id: `match-${Date.now()}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      ampversion: '0.1.0',
      correlationid: reqId,
      data: {
        request_id: ev.id,
        winning_bid_id: 'direct',
        parties: { consumer: source, provider: 'did:mesh:provider:1' },
        agreed_terms: { max_latency_ms: 0, security_level: 'OPEN' },
        session: { session_id: 's1', created_at: new Date().toISOString(), expires_at: new Date(Date.now()+3600000).toISOString(), session_token: 'tok' }
      }
    };
    return new FakeMsg(new TextEncoder().encode(JSON.stringify(match)));
  }
  subscribe(subject, opts) {
    const cb = opts.callback;
    return new FakeSub(subject, cb, this.registry);
  }
  async publish(subject, data) {
    // deliver to subscribers synchronously
    const arr = this.registry[subject] || [];
    const msg = new FakeMsg(data);
    for (const cb of arr) cb(null, msg);
    return Promise.resolve();
  }
  async close() { this.registry = {}; }
}

test('request uses reply-inbox and returns match result', async (t) => {
  const client = new MeshClient({ natsUrl: 'fake', registryUrl: 'http://localhost', did: 'did:mesh:consumer:1' });
  const fake = new FakeNats();
  // inject fake connection
  client['nc'] = fake;

  const res = await client.request({ domain: ['demo'], capabilityId: 'cap-math', timeoutMs: 2000 });
  assert.notEqual(res.kind, 'reject');
  const match = res;
  // verify match contains provider
  const provider = (match.parties && match.parties.provider) || match.provider;
  assert.equal(provider, 'did:mesh:provider:1');
});
