type SelectedLean<
  Entity,
  Fields extends SelectedLeanFields<Entity>,
  Overrides extends SelectedOverrides<Fields, Overrides> = Record<never, never>,
> = Simplify<IdPart<…> & Lean<Pick<Entity, …>> & OverridePart<…> & VirtualWithoutOverride<…>>
