import { z } from 'zod';

import { DomainErrors, ERROR_CODES } from '#shared/errors';
import { constantTimeEquals, newId, newSecretToken, sha256Hex } from '#shared/util';

import type { OrganizationRole } from './organization';

const DEFAULT_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

const emailSchema = z.email().max(320);

/**
 * The invitation as stored: an address, a role, and the digest of a secret that
 * only ever existed in memory and in the recipient's inbox.
 */
export class OrganizationInvitation {
  private constructor(
    readonly id: string,
    readonly organizationId: string,
    readonly email: string,
    readonly role: OrganizationRole,
    readonly tokenHash: string,
    readonly expiresAt: Date,
    readonly acceptedAt: Date | null,
    readonly createdAt: Date,
  ) {}

  static issue(input: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    now?: Date;
    ttlDays?: number;
  }): { invitation: OrganizationInvitation; token: string } {
    const email = emailSchema.safeParse(input.email.trim().toLowerCase());

    if (!email.success) {
      throw DomainErrors.validation(
        ERROR_CODES.INVITATION_INVALID,
        'That is not an address an invitation can reach.',
      );
    }
    if (input.role === 'owner') {
      throw DomainErrors.validation(
        ERROR_CODES.INVITATION_INVALID,
        'Ownership is transferred to an existing member, not handed out by invitation.',
      );
    }

    const now = input.now ?? new Date();
    const token = newSecretToken();

    return {
      invitation: new OrganizationInvitation(
        newId(),
        input.organizationId,
        email.data,
        input.role,
        hashInvitationToken(token),
        new Date(now.getTime() + (input.ttlDays ?? DEFAULT_TTL_DAYS) * DAY_MS),
        null,
        now,
      ),
      token,
    };
  }

  static rehydrate(input: {
    id: string;
    organizationId: string;
    email: string;
    role: OrganizationRole;
    tokenHash: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    createdAt: Date;
  }): OrganizationInvitation {
    return new OrganizationInvitation(
      input.id,
      input.organizationId,
      input.email,
      input.role,
      input.tokenHash,
      input.expiresAt,
      input.acceptedAt,
      input.createdAt,
    );
  }

  isRedeemableAt(now: Date): boolean {
    return this.acceptedAt === null && this.expiresAt.getTime() > now.getTime();
  }

  /**
   * The address on the invitation is the audience. Letting any signed-in caller
   * redeem a token they happened to obtain would turn a forwarded email into an
   * account takeover of the organization's member list.
   */
  matchesRecipient(email: string): boolean {
    return constantTimeEquals(email.trim().toLowerCase(), this.email);
  }
}

export function hashInvitationToken(token: string): string {
  return sha256Hex(token);
}
