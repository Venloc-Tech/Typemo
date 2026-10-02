const Versioned: <B extends EntityClass>(base: B) => Mixed<B, VersionFields>

interface VersionFields {
  __v: Defaulted<number>;
}
