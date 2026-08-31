import { type DomainException, isDomainException } from '#shared/errors';

export async function captureDomainError(run: () => Promise<unknown>): Promise<DomainException> {
  try {
    await run();
  } catch (error) {
    if (isDomainException(error)) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected the call to throw a DomainException, but it resolved.');
}
