# magic-orm - Known Problems

Known issues we **want to solve**. Limitations we have decided to accept live in [DEVELOPMENT.md](DEVELOPMENT.md#known-limitations-accepted). When a problem is fixed, delete its entry. Numbers are never reused; the next one is **#35**.

## Serializer

1. **`Serializer.fromObject` turns arrays into plain objects.** `{ '@type': 'A', kids: [{ '@type': 'B' }] }` comes back with `kids` as `{ "0": B }`. In `#traverse`, the `data instanceof Object` branch also matches arrays, so the `Array.isArray` branch never runs. Any entity with children then fails `Entity.fromObject`'s `$enforceOwnType` check ("expected B[], found object"). Reproduced with an ad-hoc script.
   - **Workaround:** `Serializer.fromJSON(JSON.stringify(data))`. `JSON.parse` builds the arrays itself, and its reviver handles them correctly.
   - **Intended fix:** check `Array.isArray` before `instanceof Object` in `#traverse`.

2. **`Serializer.toObject` mutates its input.** After `toObject(a)`, the entities in `a.kids` are replaced by plain `{ "@type": "B", ... }` objects. For nested arrays and plain objects, the `init` callback returns the original node instead of a fresh one, so `#traverse` writes the converted values back into the caller's data. This also affects `toJSON`, which calls `toObject`. Reproduced with an ad-hoc script.
   - **Intended fix:** have `init` always return a new container (`[]` for arrays, `{}` for plain objects, `{ '@type' }` for entities). This also fixes #3.

3. **`Serializer.toObject` empties nested plain objects when the top-level input is an array.** `toObject([new A({ meta: { x: 1 } })])` returns `[{ "@type": "A", "meta": [] }]`. The `init` callback checks `Array.isArray(data)`, the outer argument, instead of `obj`, the current node. Reproduced with an ad-hoc script.
   - **Intended fix:** see #2.

## Querying

5. **Filters on parent-table columns are silently dropped when reading a subtype with an unchained field set.** In `Entity.read`, filters on columns outside the subtype's own table are only forwarded to `read_parent` when `$config.chain[select]` exists. Otherwise they're discarded without an error, and the query returns rows the filter should have excluded. Generated configs only chain `'*'`, so `Sub.read(db, 'uuid', [{ col: 'parent_col', var: x }])` ignores its filter. `read_parent` has the same hole: when the parent has no matching field set, its local filters are never applied.
   - **Workaround:** read subtypes with the `'*'` field set whenever you filter on inherited columns.
   - **Intended fix:** always join the parent when a filter needs it, even if no parent columns are selected; otherwise throw `ORMError.InvalidState` as non-subtypes already do.

## Connections and transactions

10. **One failed `COMMIT` leaves the connection without transactions.** `Connection.#close` decrements `#containers` before running its query. If `COMMIT` throws (a deferred constraint, say), the `ROLLBACK` in `atomic`'s `finally` drops the counter to -1. From then on, `#open` never reaches 1, so every later `atomic()` on that connection runs without `BEGIN`.
    - **Workaround:** release the connection after any failed `atomic()` and acquire a fresh one.
    - **Intended fix:** only change the counter after the query succeeds, and never let it go below zero.

11. **Nested `atomic()` calls share one transaction instead of using savepoints.** An inner failure aborts the whole Postgres transaction. If code inside the outer `atomic()` catches that error and continues, the outer `COMMIT` is silently turned into a rollback by Postgres and reports no error.
    - **Workaround:** don't catch errors inside an `atomic()` callback.
    - **Intended fix:** use `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` for nested levels.

## CLI and code generation

13. **Generated model imports are broken on Windows.** `Version.typescript` builds import specifiers with `path.join`, which produces `..\defs\Models.js`. Inside a TS string literal, `\d` and `\M` are escape sequences, so the import points somewhere else.
    - **Workaround:** fix the imports in the generated model classes by hand. They're written only once; later runs skip existing files.
    - **Intended fix:** use `path.posix.join` for import specifiers (filesystem paths can keep `path.join`).

14. **Fields typed `UUID<XX>` generate the TS type `UUID<K_[object Object]>`.** `Version.generateUUIDTypeDefs` interpolates `${model}` (the model object) where it means `${name}`.
    - **Workaround:** declare references as `keys` instead of as fields.
    - **Intended fix:** interpolate `name`.

15. **Generated foreign keys don't include the schema.** `install` and the migration steps emit `REFERENCES ${fk.table}(uuid)`, which resolves through `search_path`. With `-S` set to anything other than `public`, creating the constraint fails or points at a same-named table in another schema.
    - **Workaround:** install into `public`, or give the database user a `search_path` that starts with the target schema.
    - **Intended fix:** emit `REFERENCES ${schema}.${table}(uuid)`.

18. **Migrations are half built.** `Version.upgrade` and `Version.downgrade` exist, but no CLI command calls them, while `install` tells users to "use a migration command".
    - **Intended fix:** add `upgrade` / `downgrade` commands, or remove the hint until they exist.

19. **The missing-option message names the wrong flag.** `$withDB` reports `-M <dbname>`; the option is `-N`.

20. **`confirmWaiver` clears an interval with `clearTimeout`.** It works in Node, where the two are interchangeable, but it reads like a bug. Use `clearInterval`.

34. **`install --dry-run` performs a real install.** The intended design is that a dry run executes with an undefined database connection, so every step prepares its work and logs each query as it would have run, without executing anything. None of that is wired up:
    - nothing reads `options.dryRun`;
    - `install` always connects (`withDB`), and the atomic task needs a pool;
    - the metadata step writes to the database directly;
    - `version.typescript()` writes the generated files.

    `Version.query` throws when it has no connection (since the #12 fix); before that it silently skipped the query, logging it only at DEBUG.
    - **Intended fix:** pending a review of the CLI architecture. Open questions: whether the read-only "already installed?" check should still query the database, and whether a dry run should write the TypeScript files.

## Library design

23. **The update path needs `@ts-ignore` and `any`.** `Entity.update` carries two `@ts-ignore FIXME` comments and casts through `any`, and the library has 32 errors under `--strict`.
    - **Intended fix:** type the polymorphic update loop properly, then turn on `strict` in `tsconfig.json`.

## Testing

29. **No tests.** Nothing checks queries, serialization, transactions or code generation, which is how every entry above got in. See [TESTING.md](TESTING.md) once it exists.
    - **Intended fix:** start with unit tests for `Serializer` and the query builders (no database needed). Then add a system layer against a disposable Postgres for `atomic()` and inheritance reads, and golden-file tests for `Version.typescript`.

## Single source of truth
Places that keep their own copy of a fact owned elsewhere.

30. **The length of each UUID size is stated three times.** `Entity.UUID` (what is generated), `uuidmap` in `src-bin/Version.ts` (the `VARCHAR` width) and the comment on `UUIDSize` in `Structures.ts` each encode it separately. They agree today.
    - **Intended fix:** one exported table of sizes that both the generator and the CLI import.

31. **The `UUIDSize` union is duplicated.** `src-bin/Version.ts`'s `Model` type restates `"small"|"standard"|"long"|"huge"` instead of importing `UUIDSize`.

32. **The two-letter prefix length is hard-coded in three places.** `NS` in `Structures.ts`, `substring(3)` in `Entity.$ingest`, and the `[A-Z]{2}` alias regex in `DBUtil.validate`.
