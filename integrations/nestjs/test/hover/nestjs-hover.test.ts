// Hover tests: what the IDE shows for the injected model, the feature entries, the pipes, the tokens and the mocks
// (the package resolved by name, as an application imports it).
import { describe, test } from "bun:test";
import { expectHover } from "@venloc/typemo-test-kit";

const HEAD = `
import { Injectable } from "@nestjs/common";
import { type Model, type PluginStatics } from "@venloc/typemo";
import { InjectModel, TypemoModule, ParseIdPipe, getModelToken } from "@venloc/typemo-nestjs";
import { type ModelMock } from "@venloc/typemo-nestjs/testing";
import { NtAccount, NtNote, NtCountPlugin, NtOpenAccount, NtCountry } from "../fixtures/entities.ts";
`;
const hover = (code: string) => expectHover(`${HEAD}${code}`, { dir: import.meta.dir });

describe("hover", () => {
  test("the injected model reads as the core's Model of the entity", () => {
    hover(`@Injectable() class S { constructor(@InjectModel(NtAccount) readonly accounts: Model<NtAccount>) {} }
declare const s: S;
const a = s.accounts;
//    ^?`).toBe("const a: Model<NtAccount>");
  });

  test("a read through the injected model is typed by the entity", () => {
    hover(`declare const accounts: Model<NtAccount>;
const row = await accounts.findOne({ title: "a" }).orFail().lean();
//    ^?`).toBe("const row: { title: string; balance: number; owner?: string; _id: ObjectId; }");
  });

  test("a plugin static on the injected model", () => {
    hover(`declare const notes: Model<NtNote> & PluginStatics<typeof NtCountPlugin>;
const c = notes.countTitled;
//    ^?`).toBe("const c: (title: string) => Promise<number>");
  });

  test("forFeature and a view entry", () => {
    hover(`const m = TypemoModule.forFeature([NtAccount]);
//    ^?`).toBe("const m: DynamicModule");
    hover(`const v = TypemoModule.view(NtOpenAccount, { on: NtAccount, pipeline: (p) => p.match({}).project({ title: 1, balance: 1 }) });
//    ^?`).toBe("const v: ViewFeature<NtOpenAccount>");
  });

  test("the id pipe and the model token", () => {
    hover(`const pipe = ParseIdPipe.for(NtCountry);
//    ^?`).toBe("const pipe: Type<ParseIdPipe<NtCountry>>");
    hover(`const t = getModelToken(NtAccount);
//    ^?`).toBe("const t: symbol");
  });

  test("a mocked member keeps the parameters of the model's method", () => {
    hover(`declare const m: ModelMock<Model<NtAccount>>["countDocuments"];
const x = m;
//    ^?`).toBe("const x: ((filter?: Filter<NtAccount, true> | undefined) => unknown) | undefined");
  });
});
