const Plugin: <O>(
  plugin: SchemaPlugin<O>,
  ...options: undefined extends O ? [options?: O] : [options: O]
) => <C extends EntityClass>(target: C) => void;
