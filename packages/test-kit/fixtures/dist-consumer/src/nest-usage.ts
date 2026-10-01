/*
 * Typed usage of `@venloc/typemo-nestjs` and its `/testing` entry through the built declarations; it only has to
 * compile.
 */
import type { Model } from "@venloc/typemo";
import { getModelToken, TypemoModule, type TypemoModuleFactoryOptions } from "@venloc/typemo-nestjs";
import { type ModelMock, provideClientMock, provideModelMock } from "@venloc/typemo-nestjs/testing";
import { Country, User } from "./entities.js";

export const nestUsage = (): unknown[] => {
  const token: symbol = getModelToken(User, { db: "billing" });
  const root = TypemoModule.forRootAsync({
    name: "main",
    useFactory: (): TypemoModuleFactoryOptions => ({ uri: "mongodb://localhost:27017", dbName: "app" }),
  });
  const feature = TypemoModule.forFeature([User, Country]);
  const mock: ModelMock<Model<User>> = { countDocuments: async () => 1 };
  const providers = [provideModelMock(User, mock), ...provideClientMock()];
  return [token, root, feature, providers];
};
