import type {
  FileStoragePort,
  StoredObjectFacts,
  UploadPolicy,
} from '../../../src/modules/upload/domain/file-storage.port';
import { type JournalOptions, TestJournal } from './journal';

export interface PolicyRequest {
  readonly key: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly expiresInSeconds: number;
}

export interface InMemoryFileStorageOptions extends JournalOptions {
  readonly now?: Date;
}

const OBJECT_BASE_URL = 'https://objects.test';
const MILLISECONDS_PER_SECOND = 1000;

export class InMemoryFileStorage implements FileStoragePort {
  readonly journal: TestJournal;

  readonly inspections: string[] = [];
  readonly policies: PolicyRequest[] = [];

  private readonly objects = new Map<string, StoredObjectFacts>();
  private readonly now: Date;
  private removeFailure: Error | null = null;

  constructor(options: InMemoryFileStorageOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
    this.now = options.now ?? new Date('2026-08-16T09:00:00.000Z');
  }

  put(key: string, facts: StoredObjectFacts): void {
    this.objects.set(key, facts);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  failNextRemoveWith(error: Error): void {
    this.removeFailure = error;
  }

  createUploadPolicy(input: PolicyRequest): Promise<UploadPolicy> {
    this.policies.push(input);
    this.journal.record('storage', 'createUploadPolicy', input.key);

    return Promise.resolve({
      url: `${OBJECT_BASE_URL}/${input.key}`,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.sizeBytes),
      },
      expiresAt: new Date(this.now.getTime() + input.expiresInSeconds * MILLISECONDS_PER_SECOND),
    });
  }

  inspect(key: string): Promise<StoredObjectFacts | null> {
    this.inspections.push(key);
    this.journal.record('storage', 'inspect', key);

    return Promise.resolve(this.objects.get(key) ?? null);
  }

  remove(key: string): Promise<void> {
    this.journal.record('storage', 'remove', key);

    if (this.removeFailure !== null) {
      const error = this.removeFailure;
      this.removeFailure = null;

      return Promise.reject(error);
    }

    this.objects.delete(key);

    return Promise.resolve();
  }
}
