parse<Sch extends AnyStandardSchema>(
  this: RowsOnly<Form, unknown, "parse() validates rows: call .lean() or .plain() before .parse(schema)">,
  schema: Sch,
): ParsedQuery<QueryResult<Many<Op>, Found, StandardSchemaOutput<Sch>>, StandardSchemaOutput<Sch>, Many<Op>>
