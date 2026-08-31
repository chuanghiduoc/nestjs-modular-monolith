export interface AuthModuleOptions {
  readonly secret: string;

  readonly baseUrl: string;

  readonly frontendBaseUrl: string;

  readonly trustedOrigins: readonly string[];

  readonly useSecureCookies: boolean;
  readonly requireEmailVerification: boolean;
}

export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');
