// Type tests of `@venloc/typemo-nestjs`: what compiles and what does not (each `@ts-expect-error` names the error).
import { Injectable, type Type } from "@nestjs/common";
import {
  type CreateInput,
  Entity,
  type IdOf,
  type Materialized,
  type Model,
  type PluginStatics,
  Prop,
  Schema,
  type TypedView,
  type TypemoClient,
} from "@venloc/typemo";
import { expectTypeOf } from "@venloc/typemo-test-kit";
import {
  type FeatureTarget,
  getClientToken,
  getConnectionToken,
  getModelToken,
  InjectClient,
  InjectModel,
  ParseIdPipe,
  PolicyInterceptor,
  Transactional,
  TypemoModule,
  type TypemoModuleFactoryOptions,
  type TypemoOptionsFactory,
  ValidateBodyPipe,
} from "../../src/index.ts";
import { type ModelMock, provideModelMock } from "../../src/testing/index.ts";
import { NtAccount, NtCountPlugin, type NtCountry, NtNote, NtOpenAccount, NtOwnerTotal } from "../fixtures/entities.ts";

// --- tokens ---
expectTypeOf(getClientToken()).toEqualTypeOf<string>();
expectTypeOf(getConnectionToken({ db: "billing" })).toEqualTypeOf<string>();
expectTypeOf(getModelToken(NtAccount)).toEqualTypeOf<symbol>();
// @ts-expect-error the entity is a class, not its name
getModelToken("NtAccount");
// @ts-expect-error client is a string
getModelToken(NtAccount, { client: 1 });
// @ts-expect-error FeatureTarget has client and db only
const target: FeatureTarget = { connection: "x" };
void target;

// --- injection ---
@Injectable()
export class Service {
  constructor(
    @InjectModel(NtAccount) readonly accounts: Model<NtAccount>,
    @InjectClient() readonly client: TypemoClient,
  ) {}
}
class WithArguments {
  constructor(readonly x: number) {}
}
// @ts-expect-error a class with constructor arguments is not an entity class
InjectModel(WithArguments);
// @ts-expect-error a string is not an entity class
InjectModel("NtAccount");

// The injected model is the core's typed model: filters and results are checked.
declare const accounts: Model<NtAccount>;
expectTypeOf((await accounts.findOne({ title: "a" }).orFail().lean()).balance).toEqualTypeOf<number>();
// @ts-expect-error balance is a number
accounts.find({ balance: "x" });

// --- forRoot / forRootAsync ---
TypemoModule.forRoot("mongodb://localhost:27017", { name: "main", dbName: "app", retryAttempts: 3, sync: "init" });
// @ts-expect-error sync is false, "init" or "sync"
TypemoModule.forRoot("mongodb://localhost:27017", { sync: "all" });
// @ts-expect-error retryAttempts is a number
TypemoModule.forRoot("mongodb://localhost:27017", { retryAttempts: "3" });
// @ts-expect-error onClientCreate receives the client
TypemoModule.forRoot("mongodb://localhost:27017", { onClientCreate: (client: string) => client });
TypemoModule.forRootAsync({ name: "main", useFactory: () => ({ uri: "mongodb://localhost:27017" }) });
// @ts-expect-error `name` belongs next to useFactory, not in its result
TypemoModule.forRootAsync({ useFactory: () => ({ uri: "mongodb://localhost:27017", name: "main" }) });
// @ts-expect-error the result needs uri
TypemoModule.forRootAsync({ useFactory: () => ({ dbName: "app" }) });
class Options implements TypemoOptionsFactory {
  createTypemoOptions(): TypemoModuleFactoryOptions {
    return { uri: "mongodb://localhost:27017" };
  }
}
TypemoModule.forRootAsync({ useClass: Options });
TypemoModule.forRootAsync({ useExisting: Options });
// @ts-expect-error only one of useFactory, useClass, useExisting
TypemoModule.forRootAsync({ useClass: Options, useFactory: () => ({ uri: "mongodb://localhost:27017" }) });
class NamedOptions {
  createTypemoOptions() {
    return { uri: "mongodb://localhost:27017", name: "main" };
  }
}
// @ts-expect-error the class's result has `name`
TypemoModule.forRootAsync({ useClass: NamedOptions });
// @ts-expect-error inject is not used with useClass
TypemoModule.forRootAsync({ useClass: Options, inject: [] });

// --- forFeature ---
TypemoModule.forFeature([NtAccount, { entity: NtNote, statics: NtCountPlugin }], { db: "billing" });
// @ts-expect-error the entries are classes, { entity, statics }, views or materialized results
TypemoModule.forFeature(["NtAccount"]);
// @ts-expect-error collection is set on the entity's @Schema, not in forFeature
TypemoModule.forFeature([{ entity: NtAccount, collection: "x" }]);
declare const notes: Model<NtNote> & PluginStatics<typeof NtCountPlugin>;
expectTypeOf(notes.countTitled("a")).toEqualTypeOf<Promise<number>>();

// views and materialized results are checked against their classes
const view = TypemoModule.view(NtOpenAccount, {
  on: NtAccount,
  pipeline: (p) => p.match({ balance: { $gt: 0 } }).project({ title: 1, balance: 1 }),
});
TypemoModule.forFeature([NtAccount, view]);
TypemoModule.view(NtOpenAccount, {
  on: NtAccount,
  // @ts-expect-error the rows lack `balance`, a field of the view class
  pipeline: (p) => p.project({ title: 1 }),
});
declare const openAccounts: TypedView<NtOpenAccount>;
expectTypeOf((await openAccounts.find({}))[0]?.title).toEqualTypeOf<string | undefined>();
TypemoModule.materialized(NtOwnerTotal, {
  from: NtAccount,
  // @ts-expect-error the rows lack `total`, a field of the target class
  pipeline: (p) => p.project({ title: 1 }),
});
declare const totals: Materialized<NtOwnerTotal>;
expectTypeOf(totals.refresh()).toEqualTypeOf<Promise<void>>();

// --- @Transactional ---
export class TransfersService {
  @Transactional({ client: "billing", timeoutMS: 1_000 })
  async transfer(_amount: number): Promise<void> {}

  // @ts-expect-error a transaction is asynchronous: the method returns a promise
  @Transactional()
  transferNow(): void {}
}
// @ts-expect-error not an option of a transaction
Transactional({ retries: 3 });
Transactional({ join: true });
Transactional({ join: true, client: "billing" });
Transactional({ join: false, timeoutMS: 1_000 });
// @ts-expect-error a joining method takes no transaction options: they belong to the outer transaction
Transactional({ join: true, timeoutMS: 1_000 });
// @ts-expect-error join is true or false
Transactional({ join: "yes" });

// --- pipes ---
expectTypeOf(ParseIdPipe.for(NtAccount)).toEqualTypeOf<Type<ParseIdPipe<NtAccount>>>();
declare const countryIds: ParseIdPipe<NtCountry>;
expectTypeOf(countryIds.transform("FR")).toEqualTypeOf<IdOf<NtCountry>>();
expectTypeOf(countryIds.transform("FR")).toEqualTypeOf<string>();
ValidateBodyPipe.for(NtAccount, { omit: ["owner"], partial: true, dropUnknown: true });
// @ts-expect-error `nickname` is not a field of NtAccount
ValidateBodyPipe.for(NtAccount, { pick: ["nickname"] });
declare const bodies: ValidateBodyPipe<NtAccount>;
expectTypeOf(bodies.transform({})).toEqualTypeOf<Promise<CreateInput<NtAccount>>>();

// --- policy interceptor ---
new PolicyInterceptor({ tenant: (request) => request.headers["x-tenant"] });
interface AuthRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly user: { readonly orgId: string; readonly id: string };
}
new PolicyInterceptor<AuthRequest>({ tenant: (request) => request.user.orgId, actor: (request) => request.user.id });
// @ts-expect-error the default request type has no `user`: declare your own request type
new PolicyInterceptor({ tenant: (request) => request.user });

// --- testing ---
provideModelMock(NtAccount, { countDocuments: async () => 3, findOne: () => null });
// @ts-expect-error not a member of the model
provideModelMock(NtAccount, { countAll: async () => 3 });
// @ts-expect-error countDocuments takes a filter, then options: not a number
provideModelMock(NtAccount, { countDocuments: (limit: number) => limit });
provideModelMock<typeof NtOpenAccount, TypedView<NtOpenAccount>>(NtOpenAccount, { countDocuments: async () => 1 });
type AccountMock = ModelMock<Model<NtAccount>>;
expectTypeOf<AccountMock["countDocuments"]>().not.toBeAny();

// The entity classes used here are real schemas.
@Schema({ collection: "nt_types_only" })
export class NtTypesOnly extends Entity {
  @Prop(() => String) note?: string;
}
TypemoModule.forFeature([NtTypesOnly]);
