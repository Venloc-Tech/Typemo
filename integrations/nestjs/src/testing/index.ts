/*
 * `@venloc/typemo-nestjs/testing`: mocks for unit tests without a database, and the module of tests on a real one.
 */
export { type MockProvider, type ModelMock, provideClientMock, provideModelMock } from "./model-mock.ts";
export { type ProviderLookup, TypemoTestingModule } from "./typemo-testing-module.ts";
