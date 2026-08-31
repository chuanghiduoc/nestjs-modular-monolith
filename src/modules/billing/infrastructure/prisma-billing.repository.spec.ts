import { describe, expect, it } from 'vitest';

import { parseEntitlements } from './prisma-billing.repository';

describe('parseEntitlements', () => {
  it('accepts valid feature and numeric limit definitions', () => {
    expect(parseEntitlements({ features: ['audit.export'], limits: { seats: 5 } })).toEqual({
      features: ['audit.export'],
      limits: { seats: 5 },
    });
  });

  it('rejects malformed values and negative limits', () => {
    expect(parseEntitlements({ features: [1], limits: { seats: -1 } })).toEqual({
      features: [],
      limits: {},
    });
    expect(parseEntitlements(null)).toEqual({ features: [], limits: {} });
  });
});
