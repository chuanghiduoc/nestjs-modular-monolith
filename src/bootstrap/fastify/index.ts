export { type AuthRouteOptions, CREDENTIAL_PATHS, registerAuthRoutes } from './auth-routes';
export { type LocalUploadRouteOptions, registerLocalUploadRoutes } from './local-upload-routes';
export { type FastifyPluginOptions, registerFastifyPlugins } from './plugins';
export {
  applyFastifyProblemDetailsHook,
  type ProblemDetailsHookOptions,
} from './problem-details.hook';
