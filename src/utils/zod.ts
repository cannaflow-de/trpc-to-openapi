import { ZodObject, ZodRawShape, ZodType, z } from 'zod';
import type { $ZodLazy, $ZodType, $ZodTypes } from 'zod/v4/core';
import type { $ZodTypeDef } from 'zod/v4/core/schemas';

export const instanceofZodType = (type: any): type is $ZodTypes => {
  return !!type?._zod?.def?.type;
};

export const instanceofZodTypeKind = <Z extends $ZodTypeDef['type']>(
  type: $ZodType,
  zodTypeKind: Z,
): type is $ZodTypes => {
  return type?._zod?.def?.type === zodTypeKind;
};

export const instanceofZodTypeOptional = (type: $ZodType): type is z.ZodOptional<$ZodTypes> => {
  return instanceofZodTypeKind(type, 'optional');
};

export const instanceofZodTypeObject = (type: $ZodType): type is z.ZodObject<z.ZodRawShape> => {
  return instanceofZodTypeKind(type, 'object');
};

export type ZodTypeLikeVoid = z.ZodVoid | z.ZodUndefined | z.ZodNever;

export const instanceofZodTypeLikeVoid = (type: $ZodType): type is ZodTypeLikeVoid => {
  return (
    instanceofZodTypeKind(type, 'void') ||
    instanceofZodTypeKind(type, 'undefined') ||
    instanceofZodTypeKind(type, 'never')
  );
};

export const unwrapZodType = (type: $ZodType, unwrapPreprocess: boolean): ZodType => {
  // TODO: Allow parsing array query params
  if (instanceofZodTypeKind(type, 'array')) {
    return unwrapZodType((type as z.ZodArray<$ZodTypes>).element, unwrapPreprocess);
  }
  if (instanceofZodTypeKind(type, 'enum')) {
    return unwrapZodType(z.string(), unwrapPreprocess);
  }
  if (instanceofZodTypeKind(type, 'nullable')) {
    return unwrapZodType((type as z.ZodNullable<$ZodTypes>).unwrap(), unwrapPreprocess);
  }

  if (instanceofZodTypeKind(type, 'optional')) {
    return unwrapZodType((type as z.ZodOptional<$ZodTypes>).unwrap(), unwrapPreprocess);
  }
  if (instanceofZodTypeKind(type, 'default')) {
    return unwrapZodType((type as z.ZodDefault<$ZodTypes>).unwrap(), unwrapPreprocess);
  }
  if (instanceofZodTypeKind(type, 'prefault')) {
    return unwrapZodType((type as z.ZodDefault<$ZodTypes>).unwrap(), unwrapPreprocess);
  }
  if (instanceofZodTypeKind(type, 'lazy')) {
    return unwrapZodType((type as z.ZodLazy<$ZodTypes>).def.getter(), unwrapPreprocess);
  }
  if (instanceofZodTypeKind(type, 'pipe') && unwrapPreprocess) {
    return unwrapZodType((type as z.ZodPipe<$ZodTypes>).def.out, unwrapPreprocess);
  }
  return type as ZodType;
};

export const instanceofZodTypeLikeString = (
  _type: $ZodType,
): boolean /* : _type is ZodTypeLikeString  */ => {
  const type = unwrapZodType(_type, false);

  if (instanceofZodTypeKind(type, 'pipe')) {
    return true;
  }

  // TODO improve this
  if (instanceofZodTypeKind(type, 'union')) {
    return !(type as any)._def.options.some((option: any) => !instanceofZodTypeLikeString(option));
  }

  if (instanceofZodTypeKind(type, 'intersection')) {
    return (
      instanceofZodTypeLikeString((type as z.ZodIntersection<$ZodTypes, $ZodTypes>).def.left) &&
      instanceofZodTypeLikeString((type as z.ZodIntersection<$ZodTypes, $ZodTypes>).def.right)
    );
  }

  if (instanceofZodTypeKind(type, 'literal')) {
    return typeof (type as z.ZodLiteral<any>).value === 'string';
  }

  if (instanceofZodTypeKind(type, 'enum')) {
    return !Object.values((type as z.ZodEnum<any>).enum).some((value) => typeof value === 'number');
  }

  return instanceofZodTypeKind(type, 'string');
};

export const zodSupportsCoerce = 'coerce' in z;

export type ZodTypeCoercible = z.ZodNumber | z.ZodBoolean | z.ZodBigInt | z.ZodDate;

export const instanceofZodTypeCoercible = (_type: $ZodType): _type is ZodTypeCoercible => {
  const type = unwrapZodType(_type, false);
  return (
    instanceofZodTypeKind(type, 'number') ||
    instanceofZodTypeKind(type, 'boolean') ||
    instanceofZodTypeKind(type, 'bigint') ||
    instanceofZodTypeKind(type, 'date')
  );
};

export type OpenApiCoercionSource = 'path' | 'query' | 'body';

export interface OpenApiCoercion {
  /** Location of the value in the procedure input, e.g. `['products', 0, 'vat']`. */
  path: (string | number)[];
  source: OpenApiCoercionSource;
  /** JSON type of the value as the client sent it. */
  from: 'undefined' | 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object';
  to: 'number' | 'boolean' | 'bigint' | 'date';
}

type CoercibleKind = OpenApiCoercion['to'];

const jsonTypeOf = (value: unknown): OpenApiCoercion['from'] => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  return type === 'undefined' || type === 'string' || type === 'number' || type === 'boolean'
    ? type
    : 'object';
};

// The conversions `z.coerce` applies, keyed by zod type.
const converters: Record<CoercibleKind, (value: unknown) => unknown> = {
  number: Number,
  boolean: Boolean,
  bigint: (value) => BigInt(value as string),
  date: (value) => new Date(value as string),
};

const isCoercibleKind = (kind: string): kind is CoercibleKind => kind in converters;

const hasKind = (kind: CoercibleKind, value: unknown): boolean =>
  kind === 'date' ? value instanceof Date : typeof value === kind;

interface CoercionContext {
  coercions: OpenApiCoercion[];
  source: OpenApiCoercionSource;
}

const coerceLeaf = (
  kind: CoercibleKind,
  value: unknown,
  path: (string | number)[],
  ctx: CoercionContext,
): unknown => {
  // A missing key reaches `z.coerce` as undefined. Only Boolean(undefined) gives a valid value;
  // NaN, Invalid Date and a thrown BigInt fail the same way the undefined does.
  if (hasKind(kind, value) || (value === undefined && kind !== 'boolean')) {
    return value;
  }
  ctx.coercions.push({ path: path.slice(), source: ctx.source, from: jsonTypeOf(value), to: kind });
  try {
    return converters[kind](value);
  } catch {
    // z.coerce also keeps the value when the conversion throws.
    return value;
  }
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const coerceObject = (
  schema: ZodObject<ZodRawShape>,
  value: unknown,
  path: (string | number)[],
  contextOf: (key: string) => CoercionContext | null,
): unknown => {
  if (!isPlainObject(value)) return value;
  let result = value;
  for (const [key, field] of Object.entries(schema.shape)) {
    const ctx = contextOf(key);
    if (!ctx) continue;
    path.push(key);
    const coerced = coerceValue(field, value[key], path, ctx);
    path.pop();
    if (coerced !== value[key]) {
      if (result === value) result = { ...value };
      result[key] = coerced;
    }
  }
  return result;
};

// Mirrors how zod runs each wrapper, so a value is converted exactly when `z.coerce` would
// see it. Like unwrapZodType(type, false), it stops at unions, pipes, records and enums.
// `path` is one shared stack; a recorded coercion copies it.
const coerceValue = (
  schema: $ZodType,
  value: unknown,
  path: (string | number)[],
  ctx: CoercionContext,
): unknown => {
  const def = (schema as $ZodTypes)._zod.def;
  switch (def.type) {
    case 'array': {
      if (!Array.isArray(value)) return value;
      const items: unknown[] = value;
      let result = items;
      for (let index = 0; index < items.length; index++) {
        path.push(index);
        const coerced = coerceValue(def.element, items[index], path, ctx);
        path.pop();
        if (coerced !== items[index]) {
          if (result === items) result = [...items];
          result[index] = coerced;
        }
      }
      return result;
    }
    case 'nullable':
      return value === null ? value : coerceValue(def.innerType, value, path, ctx);
    // A missing z.exactOptional() key also stays missing. `z.coerce` would give it a NaN or a false
    // that zod's object parser keeps even when a refinement rejects it.
    case 'optional':
    // zod supplies the default; a prefault is parsed by the inner type, which it already matches.
    case 'default':
    case 'prefault':
      return value === undefined ? value : coerceValue(def.innerType, value, path, ctx);
    case 'lazy':
      // zod caches the getter's schema here; calling the getter may build a new one each time.
      return coerceValue((schema as $ZodLazy)._zod.innerType, value, path, ctx);
    case 'object':
      return coerceObject(schema as ZodObject<ZodRawShape>, value, path, () => ctx);
    default:
      return isCoercibleKind(def.type) ? coerceLeaf(def.type, value, path, ctx) : value;
  }
};

/**
 * Converts the input values that `z.coerce` would convert, without changing the schema.
 * Setting `_def.coerce` on the schema instead changes it for every procedure and transport
 * that shares it, for the rest of the process.
 *
 * Only top-level keys for which `sourceOf` returns a source are converted.
 */
export const coerceInput = (
  schema: ZodObject<ZodRawShape>,
  input: unknown,
  sourceOf: (key: string) => OpenApiCoercionSource | null,
): { input: unknown; coercions: OpenApiCoercion[] } => {
  const coercions: OpenApiCoercion[] = [];
  const coerced = coerceObject(schema, input, [], (key) => {
    const source = sourceOf(key);
    return source ? { coercions, source } : null;
  });
  return { input: coerced, coercions };
};
