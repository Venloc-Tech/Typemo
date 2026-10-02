@Schema({ collection: "notes", tenant: true })
class Note extends Entity {
  @Prop(() => String)
  @Tenant()
  tenantId!: TenantField<string>;
}
