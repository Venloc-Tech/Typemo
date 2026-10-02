const Virtual: <const O extends VirtualOptions>(
  options: O,
) => <T extends object, K extends string>(target: T & VirtualCheck<T, K, O>, key: K) => void
