/**
 * Mock IModel for consumer - used by NebulaOS Agent to decide making the request.
 */

export function createMockModel(providerName = "mock", modelName = "demo") {
  return {
    providerName,
    modelName,
    async generate(messages, _tools, _options) {
      const lastUser = messages.filter((m) => m.role === "user").pop();
      const text = (lastUser?.content && typeof lastUser.content === "string")
        ? lastUser.content
        : "";
      return {
        content: text
          ? `I will request through mesh: "${text}"`
          : "Ready to request capability through mesh.",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      };
    },
    async *generateStream(_messages, _tools, _options) {
      yield { type: "content_delta", delta: "OK\n" };
      yield { type: "finish", reason: "stop" };
    },
  };
}
