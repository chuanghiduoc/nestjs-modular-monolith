import { Inject, Injectable } from '@nestjs/common';

import { createIntegrationEvent, INTEGRATION_EVENTS } from '#contracts/events';
import {
  EVENT_PUBLISHER,
  type EventPublisherPort,
  UNIT_OF_WORK,
  type UnitOfWorkPort,
} from '#contracts/ports';
import { DomainErrors, ERROR_CODES } from '#shared/errors';

import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../domain/organization.repository';

@Injectable()
export class ChangeOrganizationLifecycleUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
  ) {}

  async archive(input: {
    readonly organizationId: string;
    readonly actorId: string;
  }): Promise<void> {
    await this.changeState(input, new Date(), INTEGRATION_EVENTS.ORGANIZATION_ARCHIVED);
  }

  async restore(input: {
    readonly organizationId: string;
    readonly actorId: string;
  }): Promise<void> {
    await this.changeState(input, null, INTEGRATION_EVENTS.ORGANIZATION_RESTORED);
  }

  async purge(input: { readonly organizationId: string; readonly actorId: string }): Promise<void> {
    await this.requireOwner(input.organizationId, input.actorId);
    const organization = await this.organizations.findByIdIncludingArchived(input.organizationId);

    if (organization === null) {
      throw DomainErrors.notFound(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organization not found.');
    }
    if (organization.archivedAt === null) {
      throw DomainErrors.conflict(
        ERROR_CODES.CONFLICT,
        'Archive the organization before purging it.',
      );
    }

    await this.uow.transaction(async (tx) => {
      const purged = await this.organizations.purge(input.organizationId);

      if (!purged) {
        throw DomainErrors.conflict(
          ERROR_CODES.CONFLICT,
          'Remove tenant files and billing records before purging the organization.',
        );
      }

      await this.publisher.publishAll(tx, [
        createIntegrationEvent(INTEGRATION_EVENTS.ORGANIZATION_PURGED, {
          organizationId: input.organizationId,
          actorId: input.actorId,
        }),
      ]);
    });
  }

  private async changeState(
    input: { readonly organizationId: string; readonly actorId: string },
    archivedAt: Date | null,
    eventName:
      | typeof INTEGRATION_EVENTS.ORGANIZATION_ARCHIVED
      | typeof INTEGRATION_EVENTS.ORGANIZATION_RESTORED,
  ): Promise<void> {
    await this.requireOwner(input.organizationId, input.actorId);

    await this.uow.transaction(async (tx) => {
      const current = await this.organizations.findByIdIncludingArchived(input.organizationId);

      if (current === null) {
        throw DomainErrors.notFound(ERROR_CODES.ORGANIZATION_NOT_FOUND, 'Organization not found.');
      }
      // Already in the requested state: a repeated command or a retried request
      // after an unacknowledged success settles as a no-op, not a 404 — and the
      // transition event is not published twice.
      if (isAlreadyInState(current.archivedAt, archivedAt)) return;

      const changed = await this.organizations.setArchivedAt(input.organizationId, archivedAt);

      if (!changed) {
        throw DomainErrors.conflict(
          ERROR_CODES.CONFLICT,
          'The organization changed state concurrently. Retry the command.',
        );
      }

      await this.publisher.publishAll(tx, [
        createIntegrationEvent(eventName, {
          organizationId: input.organizationId,
          actorId: input.actorId,
        }),
      ]);
    });
  }

  private async requireOwner(organizationId: string, actorId: string): Promise<void> {
    const membership = await this.organizations.findMembershipIncludingArchived(
      organizationId,
      actorId,
    );

    if (membership?.role !== 'owner') {
      throw DomainErrors.forbidden(
        ERROR_CODES.ORGANIZATION_ACCESS_DENIED,
        'Owner access is required.',
      );
    }
  }
}

function isAlreadyInState(current: Date | null, requested: Date | null): boolean {
  if (current === null && requested === null) return true;
  if (current !== null && requested !== null) return true;

  return false;
}
