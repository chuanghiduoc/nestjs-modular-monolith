import { Controller, Get, NotFoundException, Param, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '#platform/auth';
import { ERROR_CATALOG, type ErrorCode } from '#shared/errors';

import { typeForCode } from './problem-details';

export const ERROR_DOCS_ROUTE = 'errors';

export interface ErrorDocEntry {
  readonly code: string;
  readonly type: string;
  readonly summary: string;
  readonly clientAction: string;
}

@ApiExcludeController()
@Controller({ path: ERROR_DOCS_ROUTE, version: VERSION_NEUTRAL })
export class ErrorDocsController {
  @Get()
  @Public()
  list(): { readonly errors: readonly ErrorDocEntry[] } {
    return { errors: Object.keys(ERROR_CATALOG).map((code) => describe(code as ErrorCode)) };
  }

  @Get(':slug')
  @Public()
  read(@Param('slug') slug: string): ErrorDocEntry {
    const code = slug.replaceAll('-', '_');

    if (!Object.hasOwn(ERROR_CATALOG, code)) {
      throw new NotFoundException(`No error type is documented at /errors/${slug}`);
    }

    return describe(code as ErrorCode);
  }
}

function describe(code: ErrorCode): ErrorDocEntry {
  const entry = ERROR_CATALOG[code];

  return {
    code,
    type: typeForCode(code),
    summary: entry.summary,
    clientAction: entry.clientAction,
  };
}
