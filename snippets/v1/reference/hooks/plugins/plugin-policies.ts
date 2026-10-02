interface PluginPolicies {
  readonly tenant?: true | TenantSchemaOptions;
  readonly softDelete?: true | SoftDeleteSchemaOptions;
  readonly audit?: true | AuditSchemaOptions;
}
