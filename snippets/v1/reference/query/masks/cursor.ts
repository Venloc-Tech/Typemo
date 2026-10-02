class MaskedQuery<Result, Row, Many extends boolean> implements PromiseLike<Result> {
  exec(options?: ExecOptions): Promise<Result>
  cursor(this: … Many extends true …): QueryCursor<Row>
  expect<Shape>(this: MaskedQuery<Result, Row, Many> & ExpectRows<Row, Shape>): MaskedQuery<Result, Row, Many>
}
