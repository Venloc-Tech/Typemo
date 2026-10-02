interface PluginBuilder {
  readonly target: ClassRef;
  readonly fieldKeys: readonly string[];
  addField(key: string, type: () => unknown, options?: Readonly<Record<string, unknown>>): void;
  addIndex(fields: IndexFields, options?: IndexOptions): void;
  addHook(phase: HookPhase, events: HookEvent | readonly HookEvent[], fn: HookFunction): void;
  addVirtual(key: string, options: VirtualOptions): void;
  addStatic(name: string, fn: StaticFunction): void;
  enablePolicy<K extends keyof PluginPolicies>(policy: K, options: NonNullable<PluginPolicies[K]>): void;
}
