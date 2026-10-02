const provideModelMock: <E extends EntityClass, M = Model<InstanceType<E>>>(
  entity: E,
  mock: ModelMock<NoInfer<M>>,
  target?: FeatureTarget,
) => MockProvider;
const provideClientMock: (mock?: ModelMock<TypemoClient>, name?: string) => (MockProvider | Type<TransactionalBinder>)[];
type ModelMock<M> = { readonly [K in keyof M]?: M[K] extends (...args: infer A) => unknown ? (...args: A) => unknown : M[K] };

class TypemoTestingModule {
  static forRoot(uri: string, options?: TypemoModuleOptions): DynamicModule;
  static clear(ref: ProviderLookup, name?: string): Promise<void>;
}
interface ProviderLookup {
  get(token: string, options: { readonly strict: false }): unknown;
}
