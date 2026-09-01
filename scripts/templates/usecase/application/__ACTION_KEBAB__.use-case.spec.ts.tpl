import { describe, expect, it } from 'vitest';

import { __ACTION_PASCAL__UseCase } from './__ACTION_KEBAB__.use-case';

describe('__ACTION_PASCAL__UseCase', () => {
  it('rejects every call until the behaviour is implemented', async () => {
    const useCase = new __ACTION_PASCAL__UseCase();

    await expect(useCase.execute({ callerId: 'caller' })).rejects.toThrow(/not implemented/);
  });
});
