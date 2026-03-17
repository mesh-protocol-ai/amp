/**
 * Mock IModel for demo - no API key, returns fixed response.
 * Implements the minimal interface expected by @nebulaos/core Agent.
 */

export function createMockModel(providerName = "mock", modelName = "demo") {
  return {
    providerName,
    modelName,
    async generate(messages, _tools, _options) {
      const lastUser = messages.filter((m) => m.role === "user").pop();
      const text = (lastUser?.content && typeof lastUser.content === "string")
        ? lastUser.content
        : "Hello";
      return {
        content: `[Provider] Received: "${text}". NebulaOS agent response on mesh.`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      };
    },
    async *generateStream(_messages, _tools, _options) {
      yield { type: "content_delta", delta: "[Provider] Streaming response.\n" };
      yield { type: "finish", reason: "stop" };
    },
  };
}
