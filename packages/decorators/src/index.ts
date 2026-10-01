/*
 * @venloc/typemo-decorators: the TC39 (standard) decorators of Typemo. The same names and options as the
 * legacy decorators of `@venloc/typemo`; metadata is recorded in `Symbol.metadata` and handed to the same
 * core `MetadataBuilder`, so a schema compiles identically. A project uses one decorator package only.
 */
import "./polyfill.ts";

export { Discriminator, Index, Plugin, Schema, SearchIndex } from "./class-decorators.ts";
export {
  Prop,
  type Tc39PropCheck,
  type Tc39PropDecorator,
  type Tc39TenantDecorator,
  type Tc39VirtualDecorator,
  Tenant,
  Virtual,
} from "./field-decorators.ts";
export { Post, PostError, Pre, type Tc39HookDecorator } from "./hook-decorators.ts";
