import { Inject, Injectable } from '@nestjs/common';

import {
  createIntegrationEvent,
  INTEGRATION_EVENTS,
  type IntegrationEvent,
} from '#contracts/events';
import {
  EVENT_PUBLISHER,
  type EventPublisherPort,
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '#contracts/ports';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { FILE_STORAGE, type FileStoragePort } from '../domain/file-storage.port';
import type { StoredFile } from '../domain/stored-file.entity';
import type { StoredFileEvent } from '../domain/stored-file.events';
import {
  STORED_FILE_REPOSITORY,
  type StoredFileRepository,
} from '../domain/stored-file.repository';
import type { StoredFileView } from './dto/upload.dto';
import { toStoredFileView } from './stored-file.mapper';

export interface ConfirmUploadInput {
  readonly organizationId: string;
  readonly callerId: string;
  readonly fileId: string;

  readonly correlationId?: string;
}

/**
 * The half of a presigned upload the server can actually vouch for.
 *
 * Until this runs, all the database knows is that someone asked for a URL. This
 * reads the object that was actually stored, checks it against what was
 * declared, and only then makes the file usable.
 */
@Injectable()
export class ConfirmUploadUseCase {
  constructor(
    @Inject(STORED_FILE_REPOSITORY) private readonly files: StoredFileRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
  ) {}

  async execute(input: ConfirmUploadInput): Promise<StoredFileView> {
    const file = await this.files.findByIdForOwner(
      input.organizationId,
      input.callerId,
      input.fileId,
    );

    if (file === null) {
      throw DomainErrors.notFound(ERROR_CODES.UPLOAD_NOT_FOUND, 'Upload not found.');
    }

    // Deliberately outside the transaction: this is a network call to object
    // storage, and holding a database transaction open across it would tie up a
    // connection for as long as S3 takes to answer.
    const facts = await this.storage.inspect(file.storageKey);

    if (facts === null) {
      throw DomainErrors.validation(
        ERROR_CODES.UPLOAD_OBJECT_MISSING,
        'No object was uploaded for this file.',
      );
    }

    const previousStatus = file.status;

    try {
      file.confirm({ mimeType: facts.detectedMimeType, sizeBytes: facts.sizeBytes });
    } catch (error) {
      // The bytes were wrong. Record the discard so the sweeper removes both the
      // row and the object, then report the original reason.
      if (file.status === 'discarded') {
        await this.files.compareAndSave(file, previousStatus);
        file.pullEvents();
      }
      throw error;
    }

    await this.uow.transaction(async (tx) => {
      const stored = await this.files.compareAndSave(file, previousStatus);

      if (!stored) {
        throw DomainErrors.conflict(
          ERROR_CODES.UPLOAD_ALREADY_CONFIRMED,
          'This upload was already confirmed.',
          true,
        );
      }

      await this.publisher.publishAll(tx, toIntegrationEvents(file, input.correlationId));
    });

    return toStoredFileView(file);
  }
}

function toIntegrationEvents(file: StoredFile, correlationId?: string): IntegrationEvent[] {
  return file
    .pullEvents()
    .filter((event): event is Extract<StoredFileEvent, { kind: 'StoredFileConfirmed' }> => {
      return event.kind === 'StoredFileConfirmed';
    })
    .map((event) =>
      createIntegrationEvent(
        INTEGRATION_EVENTS.UPLOAD_CONFIRMED,
        {
          fileId: event.fileId,
          organizationId: event.organizationId,
          ownerId: event.ownerId,
          storageKey: event.storageKey,
          mimeType: event.mimeType,
          sizeBytes: event.sizeBytes,
          confirmedAt: event.confirmedAt.toISOString(),
        },
        correlationId === undefined ? {} : { correlationId },
      ),
    );
}
