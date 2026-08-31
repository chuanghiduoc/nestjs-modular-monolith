export { CurrentUser, IS_PUBLIC_KEY, Public, REQUIRED_ROLES_KEY, Roles } from './auth.decorators';
export { BetterAuthGuard, RolesGuard } from './auth.guards';
export { AuthModule, type AuthModuleInput } from './auth.module';
export { AUTH_OPTIONS, type AuthModuleOptions } from './auth.options';
export { AuthService } from './auth.service';
export {
  AUTH_MAIL_KINDS,
  type AuthMailKind,
  type AuthMailPayload,
  authMailPayloadSchema,
  buildFrontendTokenUrl,
  digestAuthToken,
} from './auth-mail';
export { AuthRetentionModule, type AuthRetentionModuleInput } from './auth-retention.module';
export { AUTH_RETENTION_OPTIONS, type AuthRetentionOptions } from './auth-retention.options';
export { type AuthPruneResult, AuthRetentionService } from './auth-retention.service';
export { type AuthenticatedSession, toAuthenticatedSession } from './authenticated-session';
export {
  type AuthMailSender,
  type BetterAuthInstance,
  createBetterAuth,
} from './better-auth.factory';
