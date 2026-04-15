import type { InvocationId, LookupEntry } from "@florca/types";
import type { EventSink } from "./event_sink.ts";
import type { InvocationLoggerFactory } from "./invocation_logger.ts";
import type { WorkflowLogger } from "./workflow_logger.ts";

// deno-lint-ignore no-explicit-any
export type MessageHandler = (message: any) => any;

export type DriverState = {
  lookupTable: LookupEntry[];
  messageHandlers: Map<InvocationId, MessageHandler>;
  workflowMessageHandler: MessageHandler | null;
  eventSink: EventSink;
  invocationLoggerFactory: InvocationLoggerFactory;
  workflowLogger: WorkflowLogger;
};
