import type { FunctionName, InvocationId, LogLevel } from "@florca/types";
import type { DriverEvent } from "@florca/types";
import type { EventSink } from "./event_sink.ts";

export interface InvocationLogger {
  // deno-lint-ignore no-explicit-any
  logEvent(level: LogLevel, message: string, data?: any): void;
}

export interface InvocationLoggerFactory {
  forInvocation(
    invocationId: InvocationId,
    functionName: FunctionName,
  ): InvocationLogger;
}

class EventSinkInvocationLogger implements InvocationLogger {
  constructor(
    private readonly eventSink: EventSink,
    private readonly invocationId: InvocationId,
    private readonly functionName: FunctionName,
  ) {}

  // deno-lint-ignore no-explicit-any
  logEvent(level: LogLevel, message: string, data?: any): void {
    const invocationLogMessage: DriverEvent = {
      type: "log",
      scope: "invocation",
      level,
      message,
      data,
      invocationId: this.invocationId,
      functionName: this.functionName,
    };

    this.eventSink.addEvent(invocationLogMessage);
  }
}

export class EventSinkInvocationLoggerFactory
  implements InvocationLoggerFactory {
  constructor(private readonly eventSink: EventSink) {}

  forInvocation(
    invocationId: InvocationId,
    functionName: FunctionName,
  ): InvocationLogger {
    return new EventSinkInvocationLogger(
      this.eventSink,
      invocationId,
      functionName,
    );
  }
}
