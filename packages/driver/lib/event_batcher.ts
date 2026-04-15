import type { DriverEvent, RunId } from "@florca/types";
import { getAuthorizationHeader } from "./auth.ts";
import * as env from "./env.ts";
import type { EventSink } from "./event_sink.ts";

export class EventBatcher implements EventSink {
  private readonly runId: RunId;
  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;

  private batch: DriverEvent[] = [];
  private flushTimer: number | null = null;
  private flushChain: Promise<void> = Promise.resolve();

  constructor(runId: RunId, maxBatchSize = 100, flushIntervalMs = 100) {
    this.runId = runId;
    this.maxBatchSize = maxBatchSize;
    this.flushIntervalMs = flushIntervalMs;
  }

  addEvent(event: DriverEvent): void {
    this.batch.push(event);

    if (this.batch.length >= this.maxBatchSize) {
      void this.flush();
    } else if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    this.flushChain = this.flushChain.then(async () => {
      if (this.batch.length === 0) return;

      this.clearFlushTimer();

      const batch = this.batch;
      this.batch = [];

      await this.sendEventChunks(batch);
    });

    await this.flushChain;
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async sendEventChunks(events: DriverEvent[]): Promise<void> {
    const url = `${env.getEngineUrl()}/${this.runId}/events`;
    let nextIndex = 0;
    try {
      while (nextIndex < events.length) {
        const eventChunk = events.slice(
          nextIndex,
          nextIndex + this.maxBatchSize,
        );
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: getAuthorizationHeader(),
          },
          body: JSON.stringify(eventChunk),
        });

        if (!response.ok) {
          throw await this.newHttpRequestError(response, url);
        }

        nextIndex += eventChunk.length;
      }
    } catch (error) {
      const unsentEvents = events.slice(nextIndex);
      this.batch = [...unsentEvents, ...this.batch];

      console.error(
        `Failed to send event batch for run ${this.runId}; sent ${nextIndex}/${events.length}, preserved ${unsentEvents.length} event(s) for later delivery.`,
        error,
      );
    }
  }

  private async newHttpRequestError(
    response: Response,
    url: string,
  ): Promise<Error> {
    const errorText = await response.text().catch(() => "");
    return new Error(
      `HTTP request to ${url} failed: ${response.status} ${response.statusText}\n${errorText}`,
    );
  }
}
