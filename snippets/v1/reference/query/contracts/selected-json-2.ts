type SelectedJson<
  Entity,
  Fields extends SelectedJsonFields<Entity>,
  Overrides extends SelectedOverrides<Fields, Overrides> = Record<never, never>,
> = Simplify<IdPart<…> & PlainJson<Pick<Entity, …>> & VirtualPart<…> & OverridePart<…> & VirtualWithoutOverride<…>>
