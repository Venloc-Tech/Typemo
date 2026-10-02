interface TransactionOptions {
  readonly readConcern?: "local" | "majority" | "snapshot";
  readonly writeConcern?: { readonly w?: number | "majority"; readonly journal?: boolean };
  readonly timeoutMS?: number;
  readonly maxCommitTimeMS?: number;
}
