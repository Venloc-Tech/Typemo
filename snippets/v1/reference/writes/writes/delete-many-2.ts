deleteMany<F extends Filter<T, true>>(filter: F & NoInfer<WriteFilterCheck<T, F, "many">>): WriteBuilder<DeleteResult>
