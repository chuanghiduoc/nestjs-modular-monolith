import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('backup script safety', () => {
  it('validates restore and verify filenames before using them', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'backup.sh'), 'utf8');

    expect(script).toContain('validate_backup_file "$file"');
    expect(script).toContain('app-*.dump)');
    expect(script).toContain('backup file must not contain a path');
  });

  it('validates backup retention input before pruning', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'backup.sh'), 'utf8');

    expect(script).toContain('validate_retain');
    expect(script).toContain('BACKUP_RETAIN must be a non-negative integer');
  });
});
