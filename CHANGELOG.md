## Changelog

- v4.0.0

  - fix: convert input values instead of setting `_def.coerce` on the input schema. The old way changed shared schemas for every procedure and transport for the rest of the process, so tRPC callers also accepted `"5"` for a number and `null` for `0`
  - feat: `coerceBody: false` keeps JSON body values as sent; path and query values are still converted
  - feat: `onCoerce` reports each converted value with its location, source and types. The handler awaits it, so its errors reach `onError`
  - fix: a body key named like an `Object.prototype` member (`toString`, `constructor`) on a route without path parameters is read from the body
  - breaking: `coerceSchema` is removed; use `coerceInput`
  - Values are converted where `z.coerce` converted them, with the same results and error messages, except:
    - A missing `z.exactOptional()` key, or a missing key of an optional object whose converted prefault fails validation, stays missing, so zod handles it as if nothing was converted. Before, it could get a `NaN`, an `Invalid Date` or a `false` that skipped its refinement
    - An input that starts with a pipe, preprocess or transform is converted before that stage runs, and missing keys stay missing. Keys it renames or fills are not converted, so declare those fields with `z.coerce`. Outside production the handler warns about such inputs. A pipe of one object, or of an object and its refinement, converts as before
    - A schema instance that is also used inside a union, record, tuple, intersection, catchall, `.catch()`, `.readonly()` or field pipe is no longer converted there. Before, that depended on whether another request had already changed the shared schema
    - With several `.input()` calls, values are converted against the merged shape
    - Middlewares that call `getRawInput()` see the converted values

- v3.2.4

  - fix: skip content-type validation for mutations whose input is fully covered by path parameters

- v3.1.0

  - feat: Add API to override default generated operationId [#107](https://github.com/mcampa/trpc-to-openapi/pull/107) by [@agrippa1994](https://github.com/agrippa1994)
  - feat: enhance input handling for optional arrays in OpenAPI handler [#116](https://github.com/mcampa/trpc-to-openapi/pull/116) by [@alexkh13](https://github.com/alexkh13)
  - feat: Allows passing complex examples to objects [#121](https://github.com/mcampa/trpc-to-openapi/pull/121) by [@ntgussoni](https://github.com/ntgussoni)
  - feat: add support for schema definitions as components [#127](https://github.com/mcampa/trpc-to-openapi/pull/127) by [@bucko13](https://github.com/bucko13)
  - feat: Allow tRPC procedures without input validation [#131](https://github.com/mcampa/trpc-to-openapi/pull/131) by [@gaetansenn](https://github.com/gaetansenn)

- v3.0.1

  - fix: bug in replace reply.raw with reply https://github.com/mcampa/trpc-to-openapi/pull/104/files

- v3.0.0

  - Zod v4 and zod-openapi v5. Thanks to [edcaron](https://github.com/edcaron) for the change in https://github.com/mcampa/trpc-to-openapi/pull/98

- v2.4.0

  - fix: replace `reply.raw` with reply for fastify adapter https://github.com/mcampa/trpc-to-openapi/pull/99

- v2.3.1

  - fix: meta can be undefined

- v2.3.0

  - feat(generator): add filter option to selectively include procedures in OpenAPI output

- v2.2.0

  - Upgrade to tRPC 11.1.0

- v2.1.5

  - fix(fastify): send raw request in http handler https://github.com/mcampa/trpc-to-openapi/pull/63. Contribution by [@meriadec](https://github.com/meriadec)

- v2.1.4

  - Koa adapter https://github.com/mcampa/trpc-to-openapi/pull/47. Contribution by [@danperkins](https://github.com/danperkins)
  - Fix for Fastify adapter https://github.com/mcampa/trpc-to-openapi/pull/56. Contribution by [@natejohnson05](https://github.com/natejohnson05)

- v2.1.3

  - Export all internals https://github.com/mcampa/trpc-to-openapi/pull/44. Contribution by [@bkniffler](https://github.com/bkniffler)
  - CVE fixes by running npm audit fix.

- v2.1.2

  - bug fix: remove lodash.cloneDeep from the build output

- v2.1.1 (bad build, do not use)

  - chore: remove lodash.cloneDeep and update some dependencies

- v2.1.0

  - Updated the minimum version of `zod-openapi` to 4.1.0.
  - Changed `zod-openapi` to a peer dependency.
  - The `protect` option now defaults to `true`.
  - Improved Error schema titles

- v2.0.4

  - Upgraded to tRPC 11.0.0-rc.648.

- v2.0.3

  - Added support for array inputs in GET requests.
