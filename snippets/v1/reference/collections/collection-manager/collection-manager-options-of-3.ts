static optionsOf(source: SchemaSource): Readonly<Record<string, unknown>>
static create(db: Db, source: SchemaSource): Promise<boolean>
static ensure(db: Db, source: SchemaSource, options?: EnsureCollectionOptions): Promise<EnsureCollectionReport>
