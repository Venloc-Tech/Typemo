/*
 * `@venloc/typemo-nestjs`: the NestJS module of Typemo. A client per `forRoot`, models injected by class, transactions
 * on methods, the tenant and actor from the request, HTTP answers for the errors, pipes for ids and bodies.
 */

export type { MaterializedFeature, ModelFeature, TypemoFeature, ViewFeature } from "./feature.ts";
export type { FeatureKind } from "./feature-registry.ts";
export { InjectClient, InjectConnection, InjectModel } from "./inject.ts";
export type {
  TypemoAsyncClass,
  TypemoAsyncCommon,
  TypemoAsyncExisting,
  TypemoAsyncFactory,
  TypemoConnectOptions,
  TypemoModuleAsyncOptions,
  TypemoModuleFactoryOptions,
  TypemoModuleOptions,
  TypemoOptionsFactory,
  TypemoSync,
} from "./options.ts";
export { ParseIdPipe } from "./parse-id-pipe.ts";
export {
  AllTenants,
  PolicyInterceptor,
  type PolicyInterceptorOptions,
  type PolicyRequest,
} from "./policy-interceptor.ts";
export { type FeatureTarget, getClientToken, getConnectionToken, getModelToken } from "./tokens.ts";
export {
  Transactional,
  type TransactionalJoinOptions,
  type TransactionalOptions,
  type TransactionalOwnOptions,
} from "./transactional.ts";
export { TypemoModule } from "./typemo.module.ts";
export { TypemoCoreModule } from "./typemo-core.module.ts";
export { TypemoExceptionFilter, type TypemoHttpResponse } from "./typemo-exception-filter.ts";
export { type ValidateBodyOptions, ValidateBodyPipe } from "./validate-body-pipe.ts";
