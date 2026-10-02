const Discriminator: <const V extends string = string>(
  value?: V,
) => <C extends EntityClass>(target: C & DiscriminatorCheck<C, V>) => void
