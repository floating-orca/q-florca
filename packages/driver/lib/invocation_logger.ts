import type {
  FunctionName,
  InvocationId,
  LogLevel,
  PluginLogEvent,
} from "@florca/types";

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

class ConsoleLogInvocationLogger implements InvocationLogger {
  constructor(
    private readonly invocationId: InvocationId,
    private readonly functionName: FunctionName,
  ) {}

  // deno-lint-ignore no-explicit-any
  logEvent(level: LogLevel, message: string, data?: any): void {
    const invocationLogMessage: PluginLogEvent = {
      level,
      message,
      data,
      invocationId: this.invocationId,
      functionName: this.functionName,
    };

    console.log(JSON.stringify(invocationLogMessage));
  }
}

export class ConsoleLogInvocationLoggerFactory
  implements InvocationLoggerFactory {
  constructor() {}

  forInvocation(
    invocationId: InvocationId,
    functionName: FunctionName,
  ): InvocationLogger {
    return new ConsoleLogInvocationLogger(
      invocationId,
      functionName,
    );
  }
}
