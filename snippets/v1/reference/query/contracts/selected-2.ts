type Selected<
  Entity,
  Fields extends SelectedFields<Entity>,
  Overrides extends SelectedOverrides<Fields, Overrides> = Record<never, never>,
> = Simplify<IdPart<…> & Plain<Pick<Entity, …>> & VirtualPart<…> & OverridePart<…> & VirtualWithoutOverride<…>>
