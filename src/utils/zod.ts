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
  convertMissing: boolean;
}

const coerceLeaf = (
  kind: CoercibleKind,
  value: unknown,
  path: (string | number)[],
  ctx: CoercionContext,
): unknown => {
  if (hasKind(kind, value) || (value === undefined && !ctx.convertMissing)) return value;
  // A missing required key reaches `z.coerce` as undefined too, and its NaN or Invalid Date
  // produces the error message clients already get.
  try {
    const converted = converters[kind](value);
    ctx.coercions.push({
      path: path.slice(),
      source: ctx.source,
      from: jsonTypeOf(value),
      to: kind,
    });
    return converted;
  } catch {
    // z.coerce also keeps the value when the conversion throws.
    return value;
  }
};

const isValid = (schema: $ZodType, value: unknown): boolean => {
  try {
    return (schema as ZodType).safeParse(value).success;
  } catch {
    // safeParse throws on async refinements; keep the converted value then.
    return true;
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
    // A missing z.exactOptional() key stays missing: `z.coerce` would give it a NaN or a false
    // that zod's object parser keeps even when a refinement rejects it.
    case 'optional': {
      if (value !== undefined) return coerceValue(def.innerType, value, path, ctx);
      if (def.innerType._zod.optin !== 'optional') return value;
      // zod passes undefined on to an inner default or prefault and drops the key when that
      // fails. A converted prefault that still fails would turn the drop into an error.
      const recorded = ctx.coercions.length;
      const coerced = coerceValue(def.innerType, value, path, ctx);
      if (coerced === value || isValid(def.innerType, coerced)) return coerced;
      ctx.coercions.splice(recorded);
      return value;
    }
    // zod supplies the default without parsing it.
    case 'default':
      return value === undefined ? value : coerceValue(def.innerType, value, path, ctx);
    // zod parses the prefault value with the inner type, so it is converted like a sent value.
    case 'prefault': {
      if (value !== undefined) return coerceValue(def.innerType, value, path, ctx);
      const fallback = def.defaultValue;
      const coerced = coerceValue(def.innerType, fallback, path, ctx);
      return coerced === fallback ? value : coerced;
    }
    case 'lazy':
      // zod caches the getter's schema here; calling the getter may build a new one each time.
      return coerceValue((schema as $ZodLazy)._zod.innerType, value, path, ctx);
    case 'object':
      return coerceObject(schema as ZodObject<ZodRawShape>, value, path, () => ctx);
    default:
      return isCoercibleKind(def.type) ? coerceLeaf(def.type, value, path, ctx) : value;
  }
};

// The schema a wrapper hands its value to.
const innerOf = (schema: $ZodType): $ZodType | undefined => {
  const def = (schema as $ZodTypes)._zod.def;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
      return def.innerType;
    case 'lazy':
      return (schema as $ZodLazy)._zod.innerType;
    default:
      return undefined;
  }
};

const hasSameFields = (a: $ZodType, b: $ZodType): boolean => {
  if (!instanceofZodTypeObject(a) || !instanceofZodTypeObject(b)) return false;
  const keys = Object.keys(b.shape);
  return (
    Object.keys(a.shape).length === keys.length &&
    keys.every((key) => a.shape[key] === b.shape[key])
  );
};

interface InputPlan {
  object: ZodObject<ZodRawShape>;
  // A top-level pipe, preprocess or transform whose first stage may rename, fill or change keys.
  // A pipe of one object, or of an object and its refinement, keeps every key.
  reshaped: boolean;
}

// Finds the object that unwrapZodType(schema, true) documents.
const planInput = (schema: $ZodType, reshaped: boolean): InputPlan | null => {
  const def = (schema as $ZodTypes)._zod.def;
  if (def.type === 'object') return { object: schema as ZodObject<ZodRawShape>, reshaped };
  if (def.type === 'pipe') return planInput(def.out, reshaped || !hasSameFields(def.in, def.out));
  if (def.type === 'array') return planInput(def.element, reshaped);
  const inner = innerOf(schema);
  return inner ? planInput(inner, reshaped) : null;
};

const plans = new WeakMap<$ZodType, InputPlan | null>();

const planOf = (schema: $ZodType): InputPlan | null => {
  const cached = plans.get(schema);
  if (cached !== undefined) return cached;
  const plan = planInput(schema, false);
  plans.set(schema, plan);
  return plan;
};

/**
 * Converts the input values that `z.coerce` would convert, without changing the schema.
 * Setting `_def.coerce` on the schema instead changes it for every procedure and transport
 * that shares it, for the rest of the process.
 *
 * Only top-level keys for which `sourceOf` returns a source are converted. Behind a reshaping
 * top-level pipe, sent values are converted before its first stage runs and missing keys stay
 * missing, because that stage may fill them.
 */
export const coerceInput = (
  schema: $ZodType,
  input: unknown,
  sourceOf: (key: string) => OpenApiCoercionSource | null,
): { input: unknown; coercions: OpenApiCoercion[] } => {
  const coercions: OpenApiCoercion[] = [];
  const plan = planOf(schema);
  if (!plan) return { input, coercions };
  const convertMissing = !plan.reshaped;
  const coerced = coerceObject(plan.object, input, [], (key) => {
    const source = sourceOf(key);
    return source ? { coercions, source, convertMissing } : null;
  });
  return { input: coerced, coercions };
};

// Same reach as coerceValue. Fields declared with z.coerce convert themselves after a pipe.
const reachesConvertedField = (schema: $ZodType, seen: Set<$ZodType>): boolean => {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const def = (schema as $ZodTypes)._zod.def;
  if (def.type === 'array') return reachesConvertedField(def.element, seen);
  if (def.type === 'object') {
    return Object.values(def.shape).some((field) => reachesConvertedField(field, seen));
  }
  const inner = innerOf(schema);
  if (inner) return reachesConvertedField(inner, seen);
  return isCoercibleKind(def.type) && (def as { coerce?: boolean }).coerce !== true;
};

/**
 * True when the input starts with a reshaping pipe, preprocess or transform and its output has a
 * number, boolean, bigint or date field not declared with z.coerce. Keys that the first stage
 * renames or fills are then never converted.
 */
export const convertsBeforeTopLevelPipe = (schema: $ZodType): boolean => {
  const plan = planOf(schema);
  return plan !== null && plan.reshaped && reachesConvertedField(plan.object, new Set());
};
