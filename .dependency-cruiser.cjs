/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const forbidden = [
  {
    name: 'no-cross-context',
    comment:
      'A bounded context must not import another. Aggregate in composition/, or react to its ' +
      'integration event.',
    severity: 'error',
    from: { path: '^src/modules/([^/]+)/.+' },
    to: { path: '^src/modules/([^/]+)/.+', pathNot: '^src/modules/$1/.+' },
  },

  {
    name: 'no-upward-from-modules',
    comment: 'Dependencies point downward only. A context knows nothing of what assembles it.',
    severity: 'error',
    from: { path: '^src/modules/' },
    to: { path: '^src/(composition|bootstrap)/' },
  },
  {
    name: 'no-upward-from-platform',
    comment: 'An adapter serves the layers above it and must not reach back into them.',
    severity: 'error',
    from: { path: '^src/platform/' },
    to: { path: '^src/(modules|composition|bootstrap)/' },
  },
  {
    name: 'shared-is-a-leaf',
    comment: 'shared/ is pure and framework-agnostic. It imports nothing internal.',
    severity: 'error',
    from: { path: '^src/shared/' },
    to: { path: '^src/(?!shared/)' },
  },
  {
    name: 'contracts-is-a-leaf',
    comment:
      'contracts/ is the published kernel. If it imports a module, the module owns the contract.',
    severity: 'error',
    from: { path: '^src/contracts/' },
    to: { path: '^src/(?!contracts/|shared/)' },
  },

  {
    name: 'domain-is-pure',
    comment: 'domain/ sees nothing outside itself except shared/ and contracts/.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/domain/' },
    to: {
      path: '^src/(platform|composition|bootstrap)/|^src/modules/[^/]+/(application|infrastructure|http)/',
    },
  },
  {
    name: 'domain-has-no-framework',
    comment:
      'Allow-list, not deny-list: only zod, uuid and node: builtins keep the domain portable.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/domain/' },
    to: {
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'core'],
      pathNot: '(^|/)node_modules/(zod|uuid)(/|$)|^node:',
    },
  },
  {
    name: 'infrastructure-has-no-http',
    comment: 'A Prisma adapter must not reach into the transport layer.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/infrastructure/' },
    to: { path: '^src/modules/[^/]+/http/' },
  },
  {
    name: 'http-goes-through-application',
    comment:
      'A controller calls a use case. Injecting the repository skips every rule the use case ' +
      'enforces, and it compiles.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/http/' },
    to: { path: '^src/modules/[^/]+/infrastructure/' },
  },
  {
    name: 'application-has-no-transport',
    comment: 'A use case knows nothing about HTTP; it is reusable from a queue handler unchanged.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/application/' },
    to: { path: '^src/modules/[^/]+/http/' },
  },
  {
    name: 'application-uses-ports-not-adapters',
    comment: 'An application use case depends on the port interface, never the Prisma adapter.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/application/' },
    to: { path: '^src/modules/[^/]+/infrastructure/' },
  },
  {
    name: 'application-has-no-http-shape',
    comment: 'No @nestjs/swagger or class-validator in application/. Presentation owns HTTP shape.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/application/' },
    to: {
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'],
      path: '(^|/)node_modules/(@nestjs/swagger|class-validator|class-transformer|fastify)(/|$)',
    },
  },
  {
    name: 'application-has-no-infrastructure',
    comment: 'A use case depends on ports and never infrastructure adapters directly.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/application/' },
    to: {
      path: '^src/platform/(prisma|queue|storage|mailer|messaging)/|(^|/)node_modules/(bullmq|@prisma/client|@prisma/adapter-pg|nodemailer|@aws-sdk)(/|$)',
    },
  },
  {
    name: 'http-touches-only-transport-platform',
    comment:
      'A controller may read auth, tenant metadata and log. Other platform services belong behind a use case.',
    severity: 'error',
    from: { path: '^src/modules/[^/]+/http/' },
    to: { path: '^src/platform/', pathNot: '^src/platform/(auth|observability|tenant-context)/' },
  },

  {
    name: 'enter-context-through-barrel',
    comment: 'Outsiders import src/modules/<x> (its index.ts), never a file inside it.',
    severity: 'error',
    from: { pathNot: '^src/modules/' },
    to: { path: '^src/modules/[^/]+/.+', pathNot: '^src/modules/[^/]+/index\\.ts$' },
  },

  {
    name: 'no-circular',
    comment: 'A cycle makes initialisation order undefined and extraction impossible.',
    severity: 'error',
    from: {},
    to: { circular: true },
  },
  {
    name: 'no-orphans',
    comment: 'Dead code is deleted, not left unreferenced.',
    severity: 'error',
    from: {
      orphan: true,
      pathNot: '\\.d\\.ts$|^src/main\\.[^/]+\\.ts$|(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
    },
    to: {},
  },
  {
    name: 'no-dev-dep-in-runtime',
    comment: 'A devDependency imported from runtime code crashes the production image on boot.',
    severity: 'error',
    from: { path: '^src/', pathNot: '\\.(spec|integration)\\.ts$' },
    to: { dependencyTypes: ['npm-dev'] },
  },
  {
    name: 'no-deprecated-core',
    comment: 'A deprecated Node core module will be removed; migrate before it is.',
    severity: 'error',
    from: {},
    to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|constants)$' },
  },
];

/** @type {import('dependency-cruiser').IConfiguration} */
const configuration = {
  forbidden,
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.spec\\.ts|\\.integration\\.ts|^test/|^src/platform/prisma/generated/)' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
    },
  },
};

module.exports = configuration;
module.exports.forbidden = forbidden;
