// The e2e tests of nestjs/mongoose (references/nestjs-mongoose/tests/e2e, commit 4eb727c), ported by meaning to
// @venloc/typemo-nestjs: the same applications, requests and checks. Ledger: ./INDEX.md.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type DynamicModule, HttpStatus, type INestApplication, Module } from "@nestjs/common";
import { TypemoExceptionFilter, TypemoModule } from "../../src/index.ts";
import { NestTest } from "../support/nest-test.ts";
import { CatsModule, EventModule, NtClickLinkEvent, NtPortedEvent, NtPortedSignUpEvent } from "./cats-app.ts";

/** POSTs or GETs JSON. */
const call = async (url: string, method: string, path: string, body?: unknown) => {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

// ported from nestjs/mongoose tests/e2e/mongoose.spec.ts "Mongoose"
describe("Mongoose (mongoose.spec.ts)", () => {
  let app: INestApplication;
  let url: string;
  beforeEach(async () => {
    @Module({ imports: [TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("cats") }), CatsModule] })
    class AppModule {}
    ({ app, url } = await NestTest.app(AppModule, (a) => a.useGlobalFilters(new TypemoExceptionFilter())));
  });
  afterEach(() => app.close());

  // ported from nestjs/mongoose tests/e2e/mongoose.spec.ts:24 "should return created document"
  test("should return created document", async () => {
    const createDto = { name: "Nest", breed: "Maine coon", age: 5 };
    const { status, body } = await call(url, "POST", "/cats", createDto);
    expect(status).toBe(201);
    expect(body.name).toEqual(createDto.name);
    expect(body.age).toEqual(createDto.age);
    expect(body.breed).toEqual(createDto.breed);
  });

  // ported from nestjs/mongoose tests/e2e/mongoose.spec.ts:36 "should populate array of kittens"
  test("should populate array of kittens", async () => {
    const kittenDto = { name: "Kitten", breed: "Maine coon", age: 1 };
    const { body: kitten } = await call(url, "POST", "/cats", kittenDto);
    expect(kitten.name).toEqual(kittenDto.name);
    const parentDto = { ...kittenDto, name: "Nest", age: 5, kitten: [kitten._id] };
    const { status, body: parent } = await call(url, "POST", "/cats", parentDto);
    expect(status).toBe(201);
    expect(parent.name).toEqual("Nest");
    const { status: got, body } = await call(url, "GET", `/cat/${parent._id as string}`);
    expect(got).toBe(200);
    const kittens = body.kitten as Record<string, unknown>[];
    expect(Array.isArray(kittens)).toBe(true);
    expect(kittens[0]?._id).toBe(kitten._id);
    expect(kittens[0]?.name).toBe(kitten.name);
    expect(kittens[0]?.breed).toBe(kitten.breed);
    expect(kittens[0]?.age).toBe(kitten.age);
  });
});

// ported from nestjs/mongoose tests/e2e/mongoose-lazy-connection.spec.ts "Mongoose lazy connection"
describe("Mongoose lazy connection (mongoose-lazy-connection.spec.ts)", () => {
  let app: INestApplication;
  let url: string;
  beforeEach(async () => {
    @Module({
      imports: [
        TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("lazycats"), lazyConnection: true }),
        CatsModule,
      ],
    })
    class LazyAppModule {}
    ({ app, url } = await NestTest.app(LazyAppModule));
  });
  afterEach(() => app.close());

  // ported from nestjs/mongoose tests/e2e/mongoose-lazy-connection.spec.ts:24 "should return created document"
  test("should return created document", async () => {
    const createDto = { name: "Nest", breed: "Maine coon", age: 5 };
    const { status, body } = await call(url, "POST", "/cats", createDto);
    expect(status).toBe(201);
    expect(body).toMatchObject(createDto);
  });
});

// ported from nestjs/mongoose tests/e2e/discriminator.spec.ts "Discriminator - forFeature"
// (the "forFeatureAsync" case is not ported: the module has no forFeatureAsync, decision R64)
const features: [string, DynamicModule][] = [
  ["base and children listed", TypemoModule.forFeature([NtPortedEvent, NtClickLinkEvent, NtPortedSignUpEvent])],
  ["children first", TypemoModule.forFeature([NtPortedSignUpEvent, NtClickLinkEvent, NtPortedEvent])],
];
describe.each(features)("Discriminator - %s (discriminator.spec.ts)", (_label, feature) => {
  let app: INestApplication;
  let url: string;
  beforeEach(async () => {
    @Module({
      imports: [
        TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("events") }),
        EventModule.forFeature(feature),
      ],
    })
    class AppModule {}
    ({ app, url } = await NestTest.app(AppModule, (a) => a.useGlobalFilters(new TypemoExceptionFilter())));
  });
  afterEach(() => app.close());

  // ported from nestjs/mongoose tests/e2e/discriminator.spec.ts:69 "should return click-link document"
  test("should return click-link document", async () => {
    const createDto = { url: "http://google.com" };
    const response = await call(url, "POST", "/event/click-link", createDto);
    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toMatchObject({ ...createDto, __t: "ClickLinkEvent", time: expect.any(String) });
  });

  // ported from nestjs/mongoose tests/e2e/discriminator.spec.ts:82 "should return sign-up document"
  test("should return sign-up document", async () => {
    const createDto = { user: "testuser" };
    const response = await call(url, "POST", "/event/sign-up", createDto);
    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toMatchObject({ ...createDto, __t: "SignUpEvent", time: expect.any(String) });
  });

  // ported from nestjs/mongoose tests/e2e/discriminator.spec.ts:95 "document ($path) should not be created"
  // Divergence: nestjs/mongoose drops the unknown `testing` (strict mode) and answers 500 (an unhandled
  // ValidationError of the required field). Typemo refuses the unknown field itself (a CastError) and
  // TypemoExceptionFilter answers 400 with its path.
  test.each(["click-link", "sign-up"])("document (%s) should not be created", async (path) => {
    const response = await call(url, "POST", `/event/${path}`, { testing: 1 });
    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body).toEqual({ statusCode: 400, error: "Bad Request", message: "Invalid value", path: "testing" });
  });
});
