import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export interface SwaggerOptions {
  readonly apiPrefix: string;
  readonly version: string;
}

export function setupSwagger(app: INestApplication, options: SwaggerOptions): void {
  const config = new DocumentBuilder()
    .setTitle('API')
    .setDescription('REST surface. Errors are RFC 9457 problem+json.')
    .setVersion(options.version)

    .addCookieAuth('better-auth.session_token')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(`${options.apiPrefix}/docs`, app, document, {
    swaggerOptions: { withCredentials: true },
  });
}
