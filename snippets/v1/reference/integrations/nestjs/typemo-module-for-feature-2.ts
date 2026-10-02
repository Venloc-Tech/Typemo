static forFeature(features: readonly TypemoFeature[], target?: FeatureTarget): DynamicModule

type TypemoFeature = EntityClass | ModelFeature | ViewFeature<object> | MaterializedFeature<object>;

interface ModelFeature<E extends EntityClass = EntityClass> {
  readonly entity: E;
  readonly statics?: SchemaPlugin<never, object> | readonly SchemaPlugin<never, object>[];
}

interface FeatureTarget {
  readonly client?: string;
  readonly db?: string;
}
