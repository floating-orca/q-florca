import type { DriverEvent } from "@florca/types";

export interface EventSink {
  addEvent(event: DriverEvent): void;
  flush(): Promise<void>;
}
