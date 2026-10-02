type Discriminators<C extends object> =
  string & DefaultedMarker & ImmutableMarker & DiscriminatorsMarker<C>
