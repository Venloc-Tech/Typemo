// The pipes without HTTP: option checks, the direct form (`new ParseIdPipe(model)`), strict parsing of numeric ids.
import { describe, expect, test } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { TypemoClient } from "@venloc/typemo";
import { ParseIdPipe, ValidateBodyPipe } from "../../src/index.ts";
import { NtAccount, NtTicket } from "../fixtures/entities.ts";

const client = new TypemoClient("mongodb://127.0.0.1:1", { dbName: "nest_pipes" });
const accounts = client.connection.model(NtAccount);
const tickets = client.connection.model(NtTicket);

describe("ValidateBodyPipe options", () => {
  test("pick and omit together, an unknown option and no model are refused", () => {
    expect(() => new ValidateBodyPipe(accounts, { pick: ["title"], omit: ["owner"] })).toThrow(
      "ValidateBodyPipe: give pick or omit, not both",
    );
    expect(() => new ValidateBodyPipe(accounts, { strip: true } as never)).toThrow(
      'ValidateBodyPipe: unknown option "strip" (known: pick, omit, partial, dropUnknown)',
    );
    expect(() => new ValidateBodyPipe({} as never)).toThrow(
      "ValidateBodyPipe: a model (inject it with @InjectModel, or use ValidateBodyPipe.for(Entity))",
    );
  });

  test("the direct form validates without a server", async () => {
    const pipe = new ValidateBodyPipe(accounts, { dropUnknown: true });
    expect(await pipe.transform({ title: "Main", balance: 5, extra: 1 })).toEqual({ title: "Main", balance: 5 });
  });
});

describe("ParseIdPipe", () => {
  test("numeric ids are parsed strictly", () => {
    const pipe = new ParseIdPipe(tickets);
    expect(pipe.transform("42")).toBe(42);
    expect(pipe.transform("-7")).toBe(-7);
    for (const bad of ["1e3", "42abc", "", " 4", "0x10"])
      expect(() => pipe.transform(bad)).toThrow(BadRequestException);
  });

  test("the message names the parameter", () => {
    const pipe = new ParseIdPipe(accounts);
    expect(() => pipe.transform("zz", { type: "param", data: "accountId" })).toThrow(
      "Invalid accountId: expected ObjectId (not a 24-character hex string)",
    );
  });

  test("no model is refused", () => {
    expect(() => new ParseIdPipe({} as never)).toThrow(
      "ParseIdPipe: a model (inject it with @InjectModel, or use ParseIdPipe.for(Entity))",
    );
  });
});
