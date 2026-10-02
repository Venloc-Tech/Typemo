const Tenant: () => <T extends object, K extends string>(
  target: T & TenantCheck<T, K>,
  key: K,
  descriptor?: unknown,
) => void
