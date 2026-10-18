import { z } from 'zod';

import {
  coerceInput,
  instanceofZodTypeCoercible,
  instanceofZodTypeObject,
  unwrapZodType,
} from '../src';

// The adapter's previous behavior, kept to prove coerceInput converts the same values.
const legacyCoerceSchema = (schema: z.ZodObject<z.ZodRawShape>) => {
  Object.values(schema.shape).forEach((shapeSchema) => {
    const unwrapped = unwrapZodType(shapeSchema, false);
    if (instanceofZodTypeCoercible(unwrapped)) (unwrapped as any)._def.coerce = true;
    else if (instanceofZodTypeObject(unwrapped)) legacyCoerceSchema(unwrapped);
  });
};

const leaves = {
  number: { make: () => z.number(), fallback: 7 },
  int: { make: () => z.int(), fallback: 7 },
  boolean: { make: () => z.boolean(), fallback: true },
  refinedBoolean: { make: () => z.boolean().refine((value) => value), fallback: true },
  bigint: { make: () => z.bigint(), fallback: BigInt(7) },
  date: { make: () => z.date(), fallback: new Date(0) },
  dateWithCustomError: {
    make: () =>
      z.date({ error: (issue) => (issue.input === undefined ? undefined : 'error_blankField') }),
    fallback: new Date(0),
  },
} satisfies Record<string, { make: () => z.ZodType; fallback: unknown }>;

type LeafName = keyof typeof leaves;

const wrappers: Record<string, (leaf: z.ZodType, fallback: any) => z.ZodType> = {
  plain: (leaf) => leaf,
  optional: (leaf) => leaf.optional(),
  nullable: (leaf) => leaf.nullable(),
  nullish: (leaf) => leaf.nullish(),
  nullableOptional: (leaf) => leaf.nullable().optional(),
  optionalNullable: (leaf) => leaf.optional().nullable(),
  default: (leaf, fallback) => leaf.default(fallback),
  defaultOptional: (leaf, fallback) => leaf.default(fallback).optional(),
  prefault: (leaf, fallback) => leaf.prefault(fallback),
  array: (leaf) => z.array(leaf),
  optionalArray: (leaf) => z.array(leaf).optional(),
  arrayOfNullable: (leaf) => z.array(leaf.nullable()),
  nestedArray: (leaf) => z.array(z.array(leaf)),
  object: (leaf) => z.object({ inner: leaf }),
  optionalObject: (leaf) => z.object({ inner: leaf }).optional(),
  // The empty prefault is what clients rely on: the inner field's own conversion fills it.
  prefaultObject: (leaf) => z.object({ inner: leaf }).prefault({} as { inner: unknown }),
  prefaultObjectOptional: (leaf) =>
    z
      .object({ inner: leaf })
      .prefault({} as { inner: unknown })
      .optional(),
  arrayOfObjects: (leaf) => z.array(z.object({ inner: leaf })),
  strictObject: (leaf) => z.strictObject({ inner: leaf.optional() }),
  lazy: (leaf) => z.lazy(() => leaf),
  union: (leaf) => z.union([leaf, z.string()]),
  pipe: (leaf) => z.pipe(leaf, leaf),
  readonly: (leaf) => leaf.readonly(),
  record: (leaf) => z.record(z.string(), leaf),
  ...('exactOptional' in z.ZodType.prototype || 'exactOptional' in z.number()
    ? {
        exactOptional: (leaf: z.ZodType) => (leaf as any).exactOptional(),
        optionalExactOptional: (leaf: z.ZodType) => (leaf as any).exactOptional().optional(),
      }
    : {}),
};

const inputs: unknown[] = [
  null,
  '',
  ' ',
  '5',
  '-1.5',
  'abc',
  'true',
  'false',
  '0',
  '2026-01-15',
  '2026-01-15T10:00:00Z',
  0,
  5,
  1.5,
  true,
  false,
  [],
  [5],
  ['5'],
  ['true', null],
  [['5']],
  {},
  { inner: '5' },
  { inner: null },
  [{ inner: '5' }],
];

const ABSENT = Symbol('absent');

type Outcome =
  | { success: true; data: unknown }
  | { success: false; issues: { code: string; path: PropertyKey[]; message: string }[] };

const outcomeOf = (schema: z.ZodType, input: unknown): Outcome => {
  const result = schema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        issues: result.error.issues.map(({ code, path, message }) => ({ code, path, message })),
      };
};

const exactOptionalWrappers = Object.entries(wrappers).filter(([name]) =>
  /exactOptional/i.test(name),
);
// Without a value, z.coerce on zod 4.3 lets an optional keep a prefault that failed validation.
const missingValueChecksSeparately = (wrapperName: string) =>
  wrapperName === 'prefaultObjectOptional' ||
  exactOptionalWrappers.some(([name]) => name === wrapperName);

describe('coerceInput', () => {
  const cases = Object.entries(leaves).flatMap(([leafName, leaf]) =>
    Object.entries(wrappers).flatMap(([wrapperName, wrap]) =>
      [ABSENT, ...inputs]
        .filter((input) => input !== ABSENT || !missingValueChecksSeparately(wrapperName))
        .map((input) => ({
          name: `${leafName} in ${wrapperName} with ${input === ABSENT ? 'no value' : JSON.stringify(input)}`,
          leaf,
          wrap,
          input,
        })),
    ),
  );

  test.each(cases)('$name -> same result as z.coerce', ({ leaf, wrap, input }) => {
    const build = () => z.object({ field: wrap(leaf.make(), leaf.fallback) });
    const body = input === ABSENT ? {} : { field: input };

    const legacy = build();
    legacyCoerceSchema(legacy);
    const expected = outcomeOf(legacy, body);

    const schema = build();
    const coerced = coerceInput(schema, body, () => 'body');

    expect(outcomeOf(schema, coerced.input)).toEqual(expected);
  });

  const missingExactOptionalCases = exactOptionalWrappers.flatMap(([wrapperName, wrap]) =>
    Object.entries(leaves).map(([leafName, leaf]) => ({
      name: `${leafName} in ${wrapperName}`,
      leaf,
      wrap,
    })),
  );

  // z.exactOptional() exists from zod 4.1, and test.each refuses an empty table.
  const testEachMissingExactOptional =
    missingExactOptionalCases.length > 0 ? test.each(missingExactOptionalCases) : () => undefined;

  // z.coerce turned these into NaN, Invalid Date or a false that skipped refinements.
  testEachMissingExactOptional(
    'missing key for $name -> stays missing, nothing reported',
    ({ leaf, wrap }) => {
      const schema = z.object({ field: wrap(leaf.make(), leaf.fallback) });
      const body = {};

      const { input, coercions } = coerceInput(schema, body, () => 'body');

      expect(input).toBe(body);
      expect(coercions).toEqual([]);
    },
  );

  const optionalPrefaultCase = (leafName: LeafName) => {
    const prefaulted = () =>
      z.object({ inner: leaves[leafName].make() as z.ZodType }).prefault({} as { inner: unknown });
    const legacy = z.object({ field: prefaulted().optional() });
    legacyCoerceSchema(legacy);
    const schema = z.object({ field: prefaulted().optional() });
    return { legacy, schema, input: coerceInput(schema, {}, () => 'body').input };
  };

  test.each<LeafName>(['boolean', 'bigint'])(
    'missing key for an optional object whose %s prefault converts to a valid value or not at all -> same result as before',
    (leafName) => {
      const { legacy, schema, input } = optionalPrefaultCase(leafName);

      expect(outcomeOf(schema, input)).toEqual(outcomeOf(legacy, {}));
    },
  );

  // z.coerce kept the NaN or the refused false here on zod 4.3.
  test.each<LeafName>(['number', 'int', 'refinedBoolean', 'date', 'dateWithCustomError'])(
    'missing key for an optional object whose %s prefault converts to an invalid value -> key stays missing, zod decides as without conversion',
    (leafName) => {
      const { schema, input } = optionalPrefaultCase(leafName);

      expect(input).toEqual({});
      expect(outcomeOf(schema, input)).toEqual(outcomeOf(schema, {}));
    },
  );

  test('top-level pipe of one object or of its refinement -> same result as z.coerce', () => {
    for (const build of [
      () => {
        const object = z.object({ count: z.number(), active: z.boolean() });
        return z.pipe(object, object);
      },
      () => {
        const object = z.object({ count: z.number(), active: z.boolean() });
        return z.pipe(
          object.refine(() => true),
          object,
        );
      },
    ]) {
      for (const body of [{ count: '5', active: 'false' }, { count: null }, {}]) {
        const legacy = build();
        legacyCoerceSchema(unwrapZodType(legacy, true) as z.ZodObject<z.ZodRawShape>);
        const schema = build();
        expect(outcomeOf(schema, coerceInput(schema, body, () => 'body').input)).toEqual(
          outcomeOf(legacy, body),
        );
      }
    }
  });

  test('missing required number and date with a custom error -> same messages as z.coerce', () => {
    const build = () =>
      z.object({
        count: z.number(),
        birthDate: z.date({
          error: (issue) => (issue.input === undefined ? undefined : 'error_blankField'),
        }),
      });
    const legacy = build();
    legacyCoerceSchema(legacy);
    const schema = build();

    const outcome = outcomeOf(schema, coerceInput(schema, {}, () => 'body').input);

    expect(outcome).toEqual(outcomeOf(legacy, {}));
    expect(outcome).toMatchObject({
      issues: [
        { path: ['count'], message: 'Invalid input: expected number, received NaN' },
        { path: ['birthDate'], message: 'error_blankField' },
      ],
    });
  });

  test('top-level preprocess -> sent values converted, missing keys stay missing for it to fill', () => {
    const schema = z.preprocess(
      (value) => value,
      z.object({ count: z.number(), active: z.boolean(), page: z.number() }),
    );

    const { input, coercions } = coerceInput(schema, { page: '2' }, () => 'body');

    expect(input).toEqual({ page: 2 });
    expect(coercions).toEqual([{ path: ['page'], source: 'body', from: 'string', to: 'number' }]);
  });

  test('missing key for an optional field whose converted prefault fails validation -> nothing reported', () => {
    const schema = z.object({
      count: z
        .number()
        .min(5)
        .prefault('3' as unknown as number)
        .optional(),
      settings: z
        .object({ active: z.boolean(), kind: z.enum(['a']) })
        .prefault({} as { active: boolean; kind: 'a' })
        .optional(),
    });

    const { input, coercions } = coerceInput(schema, {}, () => 'body');

    expect(input).toEqual({});
    expect(coercions).toEqual([]);
  });

  test('numeric strings at two depths -> converted copy, schema and sent input unchanged', () => {
    const count = z.number();
    const schema = z.object({ count, items: z.array(z.object({ count })) });
    const body = { count: '5', items: [{ count: '6' }] };

    const { input } = coerceInput(schema, body, () => 'body');

    expect(input).toEqual({ count: 5, items: [{ count: 6 }] });
    expect(body).toEqual({ count: '5', items: [{ count: '6' }] });
    expect((count as any)._zod.def.coerce).toBeUndefined();
    expect(count.safeParse('5').success).toBe(false);
  });

  test('values already of the schema types -> same input object, nothing reported', () => {
    const schema = z.object({ count: z.number(), items: z.array(z.object({ count: z.number() })) });
    const body = { count: 5, items: [{ count: 6 }] };

    const { input, coercions } = coerceInput(schema, body, () => 'body');

    expect(input).toBe(body);
    expect(coercions).toEqual([]);
  });

  test('string, missing boolean, null and date string -> each reported with path, source and types', () => {
    const schema = z.object({
      id: z.number(),
      active: z.boolean(),
      items: z.array(z.object({ vat: z.number(), note: z.string() })),
      when: z.date().optional(),
    });

    const { coercions } = coerceInput(
      schema,
      { id: '4', items: [{ vat: 19, note: '1' }, { vat: null }], when: '2026-01-15' },
      (key) => (key === 'id' ? 'path' : 'body'),
    );

    expect(coercions).toEqual([
      { path: ['id'], source: 'path', from: 'string', to: 'number' },
      { path: ['active'], source: 'body', from: 'undefined', to: 'boolean' },
      { path: ['items', 1, 'vat'], source: 'body', from: 'null', to: 'number' },
      { path: ['when'], source: 'body', from: 'string', to: 'date' },
    ]);
  });

  test('sourceOf returns null for a key -> that key stays as sent', () => {
    const schema = z.object({ id: z.number(), count: z.number() });

    const { input, coercions } = coerceInput(schema, { id: '4', count: '5' }, (key) =>
      key === 'id' ? 'path' : null,
    );

    expect(input).toEqual({ id: 4, count: '5' });
    expect(coercions).toEqual([{ path: ['id'], source: 'path', from: 'string', to: 'number' }]);
  });
});
