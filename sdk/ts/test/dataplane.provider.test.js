import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderDataPlaneEndpoint } from '../dist/dataplane/provider.js';

const sampleCard = {
  metadata: { id: 'did:mesh:agent:provider-001' },
  spec: {
    domains: { primary: ['demo'] },
    capabilities: [{ id: 'echo', description: 'echo' }],
    endpoints: {
      data_plane: { grpc: 'grpc://remote.mesh.example:443' },
    },
  },
};

test('resolveProviderDataPlaneEndpoint returns endpoint and server name from registry', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ card: sampleCard }),
  });

  const result = await resolveProviderDataPlaneEndpoint({
    providerDid: sampleCard.metadata.id,
    registryUrl: 'https://registry.meshprotocol.dev',
    auth: { type: 'bearer', token: 'token' },
    fetch: mockFetch,
  });

  assert.equal(result.grpcEndpoint, 'grpc://remote.mesh.example:443');
  assert.equal(result.serverName, 'remote.mesh.example');
  assert.equal(result.card, sampleCard);
});

test('resolveProviderDataPlaneEndpoint normalizes localhost hosts to localhost serverName', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      card: {
        ...sampleCard,
        spec: {
          ...sampleCard.spec,
          endpoints: { data_plane: { grpc: 'grpc://127.0.0.1:9095' } },
        },
      },
    }),
  });

  const result = await resolveProviderDataPlaneEndpoint({
    providerDid: sampleCard.metadata.id,
    registryUrl: 'https://registry.meshprotocol.dev',
    auth: { type: 'bearer', token: 'token' },
    fetch: mockFetch,
  });

  assert.equal(result.serverName, 'localhost');
});

test('resolveProviderDataPlaneEndpoint throws when grpc endpoint is missing', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ card: { ...sampleCard, spec: { ...sampleCard.spec, endpoints: { data_plane: {} } } } }),
  });

  await assert.rejects(
    resolveProviderDataPlaneEndpoint({
      providerDid: sampleCard.metadata.id,
      registryUrl: 'https://registry.meshprotocol.dev',
      fetch: mockFetch,
    }),
    /does not publish a data_plane\.grpc endpoint/
  );
});
