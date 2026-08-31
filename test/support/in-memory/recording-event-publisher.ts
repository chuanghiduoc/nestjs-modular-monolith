import type { IntegrationEvent } from '#contracts/events';
import type { EventPublisherPort, TxHandle } from '#contracts/ports';

import { type JournalOptions, TestJournal } from './journal';

export interface PublishCall {
  readonly tx: TxHandle;
  readonly events: readonly IntegrationEvent[];
}

export class RecordingEventPublisher implements EventPublisherPort {
  readonly journal: TestJournal;

  readonly calls: PublishCall[] = [];

  private failure: Error | null = null;

  constructor(options: JournalOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
  }

  get published(): readonly IntegrationEvent[] {
    return this.calls.flatMap((call) => [...call.events]);
  }

  failNextWith(error: Error): void {
    this.failure = error;
  }

  publishAll(tx: TxHandle, events: readonly IntegrationEvent[]): Promise<void> {
    this.calls.push({ tx, events: [...events] });
    this.journal.record(
      'publisher',
      'publishAll',
      events.length === 0 ? null : events.map((event) => event.name).join(', '),
    );

    if (this.failure !== null) {
      const error = this.failure;
      this.failure = null;

      return Promise.reject(error);
    }

    return Promise.resolve();
  }
}
