class ModelChangeStream<out E> implements AsyncIterable<E, void, undefined> {
  get resumeToken(): ResumeToken
  get closed(): boolean
  next(): Promise<E>
  tryNext(): Promise<E | null>
  close(): Promise<void>
  [Symbol.asyncIterator](): AsyncGenerator<E, void, undefined>
}
