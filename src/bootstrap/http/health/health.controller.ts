import { Controller, Get, Inject, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { HealthCheck, type HealthCheckResult, HealthCheckService } from '@nestjs/terminus';

import { Public } from '#platform/auth';
import { MetricsIpGuard } from '#platform/observability';

import { HealthIndicators } from './health.indicators';
import { READINESS_CHECKS, type ReadinessChecks } from './readiness-checks';

@ApiExcludeController()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicators,
    @Inject(READINESS_CHECKS) private readonly checks: ReadinessChecks,
  ) {}

  @Get('live')
  @Public()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check(
      this.checks.map((check) => {
        switch (check) {
          case 'postgres':
            return () => this.indicators.postgres();
          case 'redis':
            return () => this.indicators.redisReachable();
          case 'queue':
            return () => this.indicators.queueStarted();
        }
      }),
    );
  }

  /**
   * Which dependency is down is operational detail, not a public fact: it tells
   * an outsider exactly when this system is least able to defend itself. Same
   * allow-list as /metrics. Liveness and readiness stay open — an orchestrator
   * has to reach them.
   */
  @Get('dependencies')
  @Public()
  @UseGuards(MetricsIpGuard)
  @HealthCheck()
  async dependencies(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.indicators.postgres(),
      () => this.indicators.redisReachable(),
      () => this.indicators.queueStarted(),
    ]);
  }
}
