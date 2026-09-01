import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts', 'gen-usecase.sh');
const templatesDir = join(process.cwd(), 'scripts', 'templates', 'usecase');

const KNOWN_PLACEHOLDERS = new Set([
  '__ACTION_KEBAB__',
  '__ACTION_PASCAL__',
  '__ACTION_CAMEL__',
  '__MODULE_KEBAB__',
  '__MODULE_PASCAL__',
  '__MODULE_CAMEL__',
  '__MODULE_SCREAM__',
]);

function listTemplates(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tpl'))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('gen-usecase script safety', () => {
  const script = () => readFileSync(scriptPath, 'utf8');

  it('refuses a module that does not exist yet', () => {
    expect(script()).toContain('does not exist');
    expect(script()).toContain('gen:module');
  });

  it('validates the action name as kebab-case', () => {
    expect(script()).toContain('is not kebab-case');
  });

  it('refuses to overwrite an existing use case', () => {
    expect(script()).toContain('already exists');
  });

  it('supports a query variant that skips the request DTO', () => {
    expect(script()).toContain('--query');
  });

  it('is exposed as pnpm gen:usecase', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['gen:usecase']).toBe('bash scripts/gen-usecase.sh');
  });
});

describe('gen-usecase templates', () => {
  it('ships the full command slice: use case, spec and request DTO', () => {
    const names = listTemplates(templatesDir).map((file) => file.replaceAll('\\', '/'));

    expect(
      names.some((file) => file.endsWith('application/__ACTION_KEBAB__.use-case.ts.tpl')),
    ).toBe(true);
    expect(
      names.some((file) => file.endsWith('application/__ACTION_KEBAB__.use-case.spec.ts.tpl')),
    ).toBe(true);
    expect(
      names.some((file) => file.endsWith('http/dto/__ACTION_KEBAB__.request.dto.ts.tpl')),
    ).toBe(true);
  });

  it('uses only placeholders the script knows how to replace', () => {
    for (const file of listTemplates(templatesDir)) {
      const content = readFileSync(file, 'utf8');
      const tokens = content.match(/__[A-Z_]+__/g) ?? [];
      const unknown = tokens.filter((token) => !KNOWN_PLACEHOLDERS.has(token));

      expect(unknown, `${file} contains unknown placeholders`).toEqual([]);
    }
  });

  it('scaffolds a body that fails loud instead of silently succeeding', () => {
    const useCase = listTemplates(templatesDir).find((file) =>
      file.endsWith('__ACTION_KEBAB__.use-case.ts.tpl'),
    );

    expect(useCase).toBeDefined();
    expect(readFileSync(useCase!, 'utf8')).toContain('Promise.reject');
    expect(readFileSync(useCase!, 'utf8')).toContain('new Error');
  });
});
