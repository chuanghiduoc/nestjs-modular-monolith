import { z } from 'zod';

export interface AuthenticatedSession {
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;

  readonly role: string;
  readonly sessionId: string;
}

const sessionShape = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    emailVerified: z.boolean(),
    role: z.string().min(1).default('member'),
  }),
  session: z.object({
    id: z.string().min(1),
  }),
});

export function toAuthenticatedSession(raw: unknown): AuthenticatedSession | null {
  const parsed = sessionShape.safeParse(raw);

  if (!parsed.success) {
    return null;
  }

  return {
    userId: parsed.data.user.id,
    email: parsed.data.user.email,
    emailVerified: parsed.data.user.emailVerified,
    role: parsed.data.user.role,
    sessionId: parsed.data.session.id,
  };
}
