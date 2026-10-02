parse<Sch extends AnyStandardSchema>(
  schema: Sch,
): ParsedQuery<StandardSchemaOutput<Sch>[], StandardSchemaOutput<Sch>, true>
