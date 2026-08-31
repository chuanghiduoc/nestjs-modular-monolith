import { type DynamicModule, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { HealthIndicators } from './health.indicators';
import { READINESS_CHECKS, type ReadinessChecks } from './readiness-checks';

@Module({})
export class HealthModule {
  static forRole(checks: ReadinessChecks): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [HealthIndicators, { provide: READINESS_CHECKS, useValue: checks }],
    };
  }
}
