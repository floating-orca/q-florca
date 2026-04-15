import type { LogLevel } from "@florca/types";
import type { DriverEvent } from "@florca/types";
import type { EventSink } from "./event_sink.ts";

export interface WorkflowLogger {
  // deno-lint-ignore no-explicit-any
  logEvent(level: LogLevel, message: string, data?: any): void;
}

export class EventSinkWorkflowLogger implements WorkflowLogger {
  constructor(private readonly eventSink: EventSink) {}

  // deno-lint-ignore no-explicit-any
  logEvent(level: LogLevel, message: string, data?: any): void {
    const workflowLogMessage: DriverEvent = {
      type: "log",
      scope: "workflow",
      level,
      message,
      data,
    };

    this.eventSink.addEvent(workflowLogMessage);
  }
}
