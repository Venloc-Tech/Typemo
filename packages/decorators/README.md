# @venloc/typemo-decorators

**Standard (TC39) decorators for [`@venloc/typemo`](https://www.npmjs.com/package/@venloc/typemo) schemas.** The core works with legacy decorators (`experimentalDecorators: true`). If your project uses the standard decorators of TypeScript 5+ instead (no `experimentalDecorators`), import the schema decorators from this package; everything else — models, queries, options, errors — comes from the core, and the schema they build is the same.

```bash
bun add @venloc/typemo @venloc/typemo-decorators mongodb bson
```

```typescript
import { Entity } from "@venloc/typemo";
import { Prop, Schema } from "@venloc/typemo-decorators";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, trim: true })
  title!: string;

  @Prop(() => Number, { min: 0 })
  balance!: number;
}
```

## What it exports

`Schema`, `Prop`, `Virtual`, `Index`, `SearchIndex`, `Discriminator`, `Plugin`, `Tenant`, and the hooks `Pre`, `Post`, `PostError` — the same names and options as the core's legacy decorators.

## Differences from the legacy mode

- **The type of a field is always a thunk:** `@Prop(() => String)`. Standard decorators get no `design:type` metadata, so `@Prop()` without a type is a compile error (and a `ConfigurationError` at run time).
- **Stricter at compile time:** a `@Prop` on a `static` or `#private` member, a hook on something that is not a method, an option of the wrong type — the compiler reports them at the decorator.
- Do not set `experimentalDecorators`; `emitDecoratorMetadata` and `reflect-metadata` are not needed; no `lib` change is required.
- Do not mix the legacy and the standard decorators in one class.

## Requirements

TypeScript 6 (standard decorators), `@venloc/typemo` 1.x as a peer dependency.

## Links

- Repository and issues: https://github.com/Venloc-Tech/typemo
- License: MIT
