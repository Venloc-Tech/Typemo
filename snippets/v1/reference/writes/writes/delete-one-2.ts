deleteOne<F extends Filter<T, true>>(filter: F & NoInfer<WriteFilterCheck<T, F, "one">>): WriteBuilder<DeleteResult>
