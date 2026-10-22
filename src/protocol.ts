import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, InitializeRequestSchema, ListToolsRequestSchema, PingRequestSchema,
  ErrorCode, isJSONRPCRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// SDK 1.x parses method params outside the handler and maps Zod failures to
// InternalError. Validate only our supported method envelopes at the transport
// boundary. Tool argument/execution errors still belong to the SDK/tool layer.
export class ValidatedTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onerror?: Transport["onerror"];
  onclose?: Transport["onclose"];
  constructor(private readonly inner: Transport) {}
  get sessionId() { return this.inner.sessionId; }
  setProtocolVersion(version: string) { this.inner.setProtocolVersion?.(version); }
  async start() {
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (error) => this.onerror?.(error);
    this.inner.onmessage = (message, extra) => {
      if (isJSONRPCRequest(message)) {
        const schemas = { initialize: InitializeRequestSchema, ping: PingRequestSchema,
          "tools/list": ListToolsRequestSchema, "tools/call": CallToolRequestSchema };
        const schema = Object.hasOwn(schemas, message.method) ? schemas[message.method as keyof typeof schemas] : undefined;
        if (schema && !schema.safeParse(message).success) {
          void this.inner.send({ jsonrpc: "2.0", id: message.id,
            error: { code: ErrorCode.InvalidParams, message: `Invalid parameters for ${message.method}` }
          }).catch((error: Error) => this.onerror?.(error));
          return;
        }
      }
      this.onmessage?.(message, extra);
    };
    await this.inner.start();
  }
  send(message: JSONRPCMessage, options?: TransportSendOptions) { return this.inner.send(message, options); }
  close() { return this.inner.close(); }
}
