/*
 * Group R: generates the SAME application twice — M models × Q queries per model, idiomatic Typemo
 * (classes + decorators, typed builders) and idiomatic Mongoose (schemas with automatic type inference,
 * `InferSchemaType`, typed populate/aggregate generics) — into a temporary directory, with a tsconfig that
 * resolves `@venloc/typemo` to its SOURCES and Mongoose to its published .d.ts. A baseline project (the
 * library imported, one model, no queries) is generated too, so the cost of the application code can be
 * separated from the cost of loading the library's types.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The libraries whose application is generated.
 *
 * @example
 * ```ts
 * const kind: CompilerContestant = "typemo";
 * ```
 */
export type CompilerContestant = "typemo" | "mongoose";

/**
 * A generated project.
 *
 * @example
 * ```ts
 * const project: GeneratedProject = CompilerProject.generate("typemo", 5, 50, "app");
 * ```
 */
export interface GeneratedProject {
  /** The project directory. */
  readonly dir: string;
  /** Path of its tsconfig. */
  readonly tsconfig: string;
  /** A snippet (placed in `dir`) with `// ^?` hover markers under query results. */
  readonly hoverSnippet: string;
  /** Total queries in the project. */
  readonly queries: number;
}

/** The directory of this file. */
const HERE = dirname(fileURLToPath(import.meta.url));
/** The repository root. */
const REPO = resolve(HERE, "../../../../..");
/** How many query templates exist. */
const TEMPLATES = 10;

/**
 * Resolves a package the bench depends on to its real directory (Bun's isolated store).
 *
 * @param name - The package name.
 * @returns The package directory.
 */
const packageDir = (name: string): string => dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)));

/** Generates the projects that are compiled. */
export class CompilerProject {
  /** The repository root. */
  static readonly repo = REPO;

  /**
   * Writes the project (or the baseline when `queries` = 0 and `models` = 1) and returns where it is.
   *
   * @param contestant - Whose application to generate.
   * @param models - How many models.
   * @param queries - How many queries per model.
   * @param tag - Names the project directory.
   * @returns The project.
   */
  static generate(contestant: CompilerContestant, models: number, queries: number, tag: string): GeneratedProject {
    const dir = join(tmpdir(), "typemo-bench-r", `${contestant}-${tag}-${models}x${queries}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tsconfig = join(dir, "tsconfig.json");
    writeFileSync(tsconfig, JSON.stringify(CompilerProject.tsconfig(), null, 2));
    const gen = contestant === "typemo" ? TypemoSource : MongooseSource;
    writeFileSync(join(dir, "common.ts"), gen.common());
    for (let k = 0; k < models; k++) writeFileSync(join(dir, `model-${k}.ts`), gen.model(k, queries));
    return { dir, tsconfig, hoverSnippet: gen.hover(Math.min(models, 3)), queries: models * queries };
  }

  /**
   * The tsconfig of a generated project.
   *
   * @returns The tsconfig object.
   */
  static tsconfig(): object {
    return {
      extends: join(REPO, "tsconfig.base.json"),
      compilerOptions: {
        noEmit: true,
        composite: false,
        declaration: false,
        declarationMap: false,
        emitDeclarationOnly: false,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        typeRoots: [join(REPO, "node_modules/@types")],
        paths: {
          "@venloc/typemo": [join(REPO, "packages/typemo/src/index.ts")],
          mongoose: [packageDir("mongoose")],
          mongodb: [packageDir("mongodb")],
          bson: [packageDir("bson")],
        },
      },
      include: ["*.ts"],
    };
  }

  /**
   * Query template index of query j (the same sequence for both contestants).
   *
   * @param j - The query number.
   * @returns The template index.
   */
  static template(j: number): number {
    return j % TEMPLATES;
  }
}

/** Idiomatic Typemo source. */
class TypemoSource {
  /**
   * The shared source file.
   *
   * @returns The TypeScript source.
   */
  static common(): string {
    return `import { Entity, Prop, Schema } from "@venloc/typemo";
export const use = (value: unknown): void => { void value; };

@Schema({ nested: true })
export class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) zip?: string;
}

@Schema()
export class Item extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true }) qty!: number;
}
export { Entity };
`;
  }

  /**
   * The source of model `k` with its queries.
   *
   * @param k - The model number.
   * @param queries - How many queries.
   * @returns The TypeScript source.
   */
  static model(k: number, queries: number): string {
    const parent = k > 0 ? `M${k - 1}` : `M${k}`;
    const lines: string[] = [
      `import { Entity, fn, Prop, type Ref, Schema, Types, type TypemoClient } from "@venloc/typemo";`,
      `import { Address, Item, use } from "./common.ts";`,
      k > 0 ? `import { M${k - 1} } from "./model-${k - 1}.ts";` : "",
      "",
      `@Schema({ collection: "m${k}" })`,
      `export class M${k} extends Entity {`,
      `  @Prop(() => String, { required: true }) name!: string;`,
      `  @Prop(() => Number, { required: true }) count!: number;`,
      `  @Prop(() => Date) createdOn?: Date;`,
      `  @Prop(() => [String]) tags!: string[];`,
      `  @Prop(() => Boolean, { required: true }) active!: boolean;`,
      `  @Prop(() => Address) address?: Address;`,
      `  @Prop(() => Types.ObjectId, { ref: () => ${parent} }) parent?: Ref<${parent}>;`,
      `  @Prop(() => [Item]) items!: Item[];`,
      `}`,
      "",
      `export async function queries${k}(client: TypemoClient, id: Types.ObjectId): Promise<void> {`,
      `  const M = client.connection.model(M${k});`,
    ];
    for (let j = 0; j < queries; j++) lines.push(TypemoSource.query(j, k));
    lines.push("}");
    return lines.join("\n");
  }

  /**
   * The source of one query.
   *
   * @param j - The query number.
   * @param k - The model number.
   * @returns One line of TypeScript.
   */
  static query(j: number, k: number): string {
    switch (CompilerProject.template(j)) {
      case 0:
        return `  { const r = await M.find({ name: "x${j}", count: { $gte: ${j} } }).sort({ count: -1 }).limit(10).lean(); use(r[0]?.name); }`;
      case 1:
        return `  { const r = await M.findById(id).orFail(); use(r.tags.length + r.count); }`;
      case 2:
        return `  { await M.updateOne({ active: true }, { $set: { name: "y${j}" }, $inc: { count: 1 } }); }`;
      case 3:
        return `  { const r = await M.find({ name: { $in: ["a", "b"] } }).select({ name: 1, count: 1 }).lean(); use(r[0]?.count); }`;
      case 4:
        return `  { const n = await M.countDocuments({ createdOn: { $lt: new Date() } }); use(n + 1); }`;
      case 5:
        return `  { const r = await M.findOneAndUpdate({ name: "z${j}" }, { $push: { tags: "t" } }).lean(); use(r?.tags); }`;
      case 6:
        return `  { await M.deleteMany({ count: { $lt: 0 } }); }`;
      case 7:
        return `  { const r = await M.aggregate((p) => p.match({ active: true }).group((f) => ({ _id: f.name, total: fn.sum(f.count) }))); use(r[0]?.total); }`;
      case 8:
        return k > 0
          ? `  { const r = await M.find({ active: true }).populate("parent").lean(); use(r[0]?.parent?.name); }`
          : `  { const r = await M.find({ "address.city": "Oslo" }).lean(); use(r[0]?.address?.city); }`;
      default:
        return `  { const d = await M.create({ name: "n${j}", count: ${j}, tags: [], active: true, items: [{ sku: "s", qty: 1 }] }); use(d._id); }`;
    }
  }

  /**
   * A snippet with hover markers under query results.
   *
   * @param models - How many models the snippet uses.
   * @returns The TypeScript source.
   */
  static hover(models: number): string {
    const lines = [
      `import type { TypemoClient, Types } from "@venloc/typemo";`,
      ...Array.from({ length: models }, (_, k) => `import { M${k} } from "./model-${k}.ts";`),
      `export async function hovers(client: TypemoClient, id: Types.ObjectId): Promise<void> {`,
    ];
    for (let k = 0; k < models; k++) {
      lines.push(`  const m${k} = client.connection.model(M${k});`);
      lines.push(`  const a${k} = await m${k}.find({ count: { $gte: 1 } }).lean();`, `  //    ^?`);
      lines.push(`  const b${k} = await m${k}.findById(id).orFail();`, `  //    ^?`);
      lines.push(`  const c${k} = m${k}.updateOne({ active: true }, { $inc: { count: 1 } });`, `  //    ^?`);
      lines.push(`  void [a${k}, b${k}, c${k}];`);
    }
    lines.push("}");
    return lines.join("\n");
  }
}

/** Idiomatic Mongoose source: schemas with automatic inference; explicit generics where Mongoose needs them. */
class MongooseSource {
  /**
   * The shared source file.
   *
   * @returns The TypeScript source.
   */
  static common(): string {
    return `import { Schema } from "mongoose";
export const use = (value: unknown): void => { void value; };
export const addressSchema = new Schema({ city: { type: String, required: true }, zip: String }, { _id: false });
export const itemSchema = new Schema({ sku: { type: String, required: true }, qty: { type: Number, required: true } });
`;
  }

  /**
   * The source of model `k` with its queries.
   *
   * @param k - The model number.
   * @param queries - How many queries.
   * @returns The TypeScript source.
   */
  static model(k: number, queries: number): string {
    const lines: string[] = [
      `import { type InferSchemaType, model, Schema, type Types } from "mongoose";`,
      `import { addressSchema, itemSchema, use } from "./common.ts";`,
      k > 0 ? `import type { schema${k - 1} } from "./model-${k - 1}.ts";` : "",
      "",
      `export const schema${k} = new Schema({`,
      `  name: { type: String, required: true },`,
      `  count: { type: Number, required: true },`,
      `  createdOn: Date,`,
      `  tags: [String],`,
      `  active: { type: Boolean, required: true },`,
      `  address: addressSchema,`,
      `  parent: { type: Schema.Types.ObjectId, ref: "M${k > 0 ? k - 1 : k}" },`,
      `  items: [itemSchema],`,
      `});`,
      `export const M${k} = model("M${k}", schema${k});`,
      k > 0 ? `type Parent${k} = InferSchemaType<typeof schema${k - 1}>;` : "",
      "",
      `export async function queries${k}(id: Types.ObjectId): Promise<void> {`,
      `  const M = M${k};`,
    ];
    for (let j = 0; j < queries; j++) lines.push(MongooseSource.query(j, k));
    lines.push("}");
    return lines.join("\n");
  }

  /**
   * The source of one query.
   *
   * @param j - The query number.
   * @param k - The model number.
   * @returns One line of TypeScript.
   */
  static query(j: number, k: number): string {
    switch (CompilerProject.template(j)) {
      case 0:
        return `  { const r = await M.find({ name: "x${j}", count: { $gte: ${j} } }).sort({ count: -1 }).limit(10).lean(); use(r[0]?.name); }`;
      case 1:
        return `  { const r = await M.findById(id).orFail(); use(r.tags.length + r.count); }`;
      case 2:
        return `  { await M.updateOne({ active: true }, { $set: { name: "y${j}" }, $inc: { count: 1 } }); }`;
      case 3:
        return `  { const r = await M.find({ name: { $in: ["a", "b"] } }).select({ name: 1, count: 1 }).lean(); use(r[0]?.count); }`;
      case 4:
        return `  { const n = await M.countDocuments({ createdOn: { $lt: new Date() } }); use(n + 1); }`;
      case 5:
        return `  { const r = await M.findOneAndUpdate({ name: "z${j}" }, { $push: { tags: "t" } }, { new: true }).lean(); use(r?.tags); }`;
      case 6:
        return `  { await M.deleteMany({ count: { $lt: 0 } }); }`;
      case 7:
        return `  { const r = await M.aggregate<{ _id: string; total: number }>([{ $match: { active: true } }, { $group: { _id: "$name", total: { $sum: "$count" } } }]); use(r[0]?.total); }`;
      case 8:
        return k > 0
          ? `  { const r = await M.find({ active: true }).populate<{ parent: Parent${k} | null }>("parent").lean(); use(r[0]?.parent?.name); }`
          : `  { const r = await M.find({ "address.city": "Oslo" }).lean(); use(r[0]?.address?.city); }`;
      default:
        return `  { const d = await M.create({ name: "n${j}", count: ${j}, tags: [], active: true, items: [{ sku: "s", qty: 1 }] }); use(d._id); }`;
    }
  }

  /**
   * A snippet with hover markers under query results.
   *
   * @param models - How many models the snippet uses.
   * @returns The TypeScript source.
   */
  static hover(models: number): string {
    const lines = [
      `import type { Types } from "mongoose";`,
      ...Array.from({ length: models }, (_, k) => `import { M${k} } from "./model-${k}.ts";`),
      `export async function hovers(id: Types.ObjectId): Promise<void> {`,
    ];
    for (let k = 0; k < models; k++) {
      lines.push(`  const a${k} = await M${k}.find({ count: { $gte: 1 } }).lean();`, `  //    ^?`);
      lines.push(`  const b${k} = await M${k}.findById(id).orFail();`, `  //    ^?`);
      lines.push(`  const c${k} = M${k}.updateOne({ active: true }, { $inc: { count: 1 } });`, `  //    ^?`);
      lines.push(`  void [a${k}, b${k}, c${k}];`);
    }
    lines.push("}");
    return lines.join("\n");
  }
}
