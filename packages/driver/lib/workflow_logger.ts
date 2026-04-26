import type { LogEvent, LogLevel } from "@florca/types";

export interface WorkflowLogger {
  // deno-lint-ignore no-explicit-any
  logEvent(level: LogLevel, message: string, data?: any): void;
}

export class ConsoleLogWorkflowLogger implements WorkflowLogger {
  constructor() {}

  // deno-lint-ignore no-explicit-any
  logEvent(level: LogLevel, message: string, data?: any): void {
    const workflowLogMessage: LogEvent = {
      level,
      message,
      data,
    };

    console.log(JSON.stringify(workflowLogMessage));
  }
}
