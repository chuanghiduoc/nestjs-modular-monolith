export interface JournalEntry {
  readonly source: string;
  readonly action: string;
  readonly ref: string | null;
}

export class TestJournal {
  private readonly log: JournalEntry[] = [];

  record(source: string, action: string, ref: string | null = null): void {
    this.log.push({ source, action, ref });
  }

  get entries(): readonly JournalEntry[] {
    return this.log;
  }

  trail(): string[] {
    return this.log.map((entry) => `${entry.source}:${entry.action}`);
  }

  clear(): void {
    this.log.length = 0;
  }
}

export interface JournalOptions {
  readonly journal?: TestJournal;
}
