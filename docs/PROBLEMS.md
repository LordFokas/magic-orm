# magic-orm - Known Problems

Known issues we **want to solve**. Limitations we have decided to accept live in [DEVELOPMENT.md](DEVELOPMENT.md#known-limitations-accepted). When a problem is fixed, delete its entry. Numbers are never reused; the next one is **#34**.

## Serializer

1. **`Serializer.fromObject` turns arrays into plain objects.** `{ '@type': 'A', kids: [{ '@type': 'B' }] }` comes back with `kids` as `{ "0": B }`. In `#traverse`, the `data instanceof Object` branch also matches arrays, so the `Array.isArray` branch never runs. Any entity with children then fails `Entity.fromObject`'s `$enforceOwnType` check ("expected B[], found object"). Reproduced with an ad-hoc script.
   - **Workaround:** `Serializer.fromJSON(JSON.stringify(data))`. `JSON.parse` builds the arrays itself, and its reviver handles them correctly.
   - **Intended fix:** check `Array.isArray` before `instanceof Object` in `#traverse`.

2. **`Serializer.toObject` mutates its input.** After `toObject(a)`, the entities in `a.kids` are replaced by plain `{ "@type": "B", ... }` objects. For nested arrays and plain objects, the `init` callback returns the original node instead of a fresh one, so `#traverse` writes the converted values back into the caller's data. This also affects `toJSON`, which calls `toObject`. Reproduced with an ad-hoc script.
   - **Intended fix:** have `init` always return a new container (`[]` for arrays, `{}` for plain objects, `{ '@type' }` for entities). This also fixes #3.

3. **`Serializer.toObject` empties nested plain objects when the top-level input is an array.** `toObject([new A({ meta: { x: 1 } })])` returns `[{ "@type": "A", "meta": [] }]`. The `init` callback checks `Array.isArray(data)`, the outer argument, instead of `obj`, the current node. Reproduced with an ad-hoc script.
   - **Intended fix:** see #2.

4. **The entity registry is keyed by `constructor.name`.** `Serializer.register` and `toObject` look classes up by their JavaScript name. Minification breaks the lookup, and two classes with the same name in different modules overwrite each other.
   - **Intended fix:** key the reverse map by the class itself (a `Map<Class, string>`).

## Querying

5. **Filters on parent-table columns are silently dropped when reading a subtype with an unchained field set.** In `Entity.read`, filters on columns outside the subtype's own table are only forwarded to `read_parent` when `$config.chain[select]` exists. Otherwise they're discarded without an error, and the query returns rows the filter should have excluded. Generated configs only chain `'*'`, so `Sub.read(db, 'uuid', [{ col: 'parent_col', var: x }])` ignores its filter. `read_parent` has the same hole: when the parent has no matching field set, its local filters are never applied.
   - **Workaround:** read subtypes with the `'*'` field set whenever you filter on inherited columns.
   - **Intended fix:** always join the parent when a filter needs it, even if no parent columns are selected; otherwise throw `ORMError.InvalidState` as non-subtypes already do.

6. **Every `?` in a query is treated as a placeholder.** `DBUtil.validate` counts every `?` and `DBUtil.pgps` rewrites every one to `$n`, including those inside string literals and Postgres's JSONB operators (`?`, `?|`, `?&`). Such queries fail with "Invalid Parameterization".
   - **Workaround:** pass literals as parameters, and use `jsonb_exists()` / `jsonb_exists_any()` / `jsonb_exists_all()` instead of the operators.
   - **Intended fix:** options are skipping quoted strings when scanning, or switching the builders to emit `$n` directly. Leaning towards the second.

7. **A `FilterVal` with a falsy `val` becomes a placeholder with no parameter.** `QueryBuilder.filter` writes `f.val || '?'`, so `val: 0` or `val: ''` emits `?` without pushing a parameter, and the query fails the parameter-count check.
   - **Workaround:** use `var` for values.
   - **Intended fix:** test `f.val !== undefined`.

8. **Identifiers and raw fragments are concatenated into SQL.** Values are parameterized, but column names (`Filter.col`), `FilterVal.val`, `SelectBuilder.order`, `Connection.schema()` and the CLI's `-S` schema all go into the query text unchecked. That's safe only while every caller is trusted code.
   - **Intended fix:** validate column names against the entity's field sets, and quote identifiers with a single helper. Decide whether `FilterVal.val` stays as a deliberate raw-SQL escape hatch; if it does, it's an accepted limitation and should be documented as one.

9. **Leftover MySQL boolean handling.** `DBUtil.patch` sends `true`/`false` as `1`/`0`, and `Entity.#booleans` converts the strings `'1'`/`'0'` back. Postgres has a native boolean type and `pg` returns real booleans, so at best this code does nothing, and it hides what's actually stored.
   - **Intended fix:** remove both conversions once a test confirms booleans round-trip natively.

## Connections and transactions

10. **One failed `COMMIT` leaves the connection without transactions.** `Connection.#close` decrements `#containers` before running its query. If `COMMIT` throws (a deferred constraint, say), the `ROLLBACK` in `atomic`'s `finally` drops the counter to -1. From then on, `#open` never reaches 1, so every later `atomic()` on that connection runs without `BEGIN`.
    - **Workaround:** release the connection after any failed `atomic()` and acquire a fresh one.
    - **Intended fix:** only change the counter after the query succeeds, and never let it go below zero.

11. **Nested `atomic()` calls share one transaction instead of using savepoints.** An inner failure aborts the whole Postgres transaction. If code inside the outer `atomic()` catches that error and continues, the outer `COMMIT` is silently turned into a rollback by Postgres and reports no error.
    - **Workaround:** don't catch errors inside an `atomic()` callback.
    - **Intended fix:** use `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` for nested levels.

## CLI and code generation

12. **CLI "atomic" tasks run on the pool, not on one connection.** `Task.Atomic` sends `BEGIN`, the steps and `COMMIT` through `pg.Pool.query`, and each call may check out a different client. It works today only because the steps run one after another and pg-pool hands back the most recently released client. Nothing guarantees that, and the client is returned to the pool with a transaction still open.
    - **Intended fix:** check out one `PoolClient` for the duration of the task, and pass that client to `Version` and to the steps.

13. **Generated model imports are broken on Windows.** `Version.typescript` builds import specifiers with `path.join`, which produces `..\defs\Models.js`. Inside a TS string literal, `\d` and `\M` are escape sequences, so the import points somewhere else.
    - **Workaround:** fix the imports in the generated model classes by hand. They're written only once; later runs skip existing files.
    - **Intended fix:** use `path.posix.join` for import specifiers (filesystem paths can keep `path.join`).

14. **Fields typed `UUID<XX>` generate the TS type `UUID<K_[object Object]>`.** `Version.generateUUIDTypeDefs` interpolates `${model}` (the model object) where it means `${name}`.
    - **Workaround:** declare references as `keys` instead of as fields.
    - **Intended fix:** interpolate `name`.

15. **Generated foreign keys don't include the schema.** `install` and the migration steps emit `REFERENCES ${fk.table}(uuid)`, which resolves through `search_path`. With `-S` set to anything other than `public`, creating the constraint fails or points at a same-named table in another schema.
    - **Workaround:** install into `public`, or give the database user a `search_path` that starts with the target schema.
    - **Intended fix:** emit `REFERENCES ${schema}.${table}(uuid)`.

16. **`magic-orm -V` prints the wrong version.** `MagicCLI` reads `./package.json` relative to the working directory, which is the user's project, not magic-orm.
    - **Intended fix:** resolve `package.json` relative to the CLI's own module (`import.meta.url`).

17. **Read-only commands write to the database.** `status` and `typescript current` call `createMetadataTable`, so checking the version creates a table.
    - **Intended fix:** read with a query that treats a missing table as "nothing installed", and create the table only in `install`.

18. **Migrations are half built.** `Version.upgrade` and `Version.downgrade` exist, but no CLI command calls them, while `install` tells users to "use a migration command".
    - **Intended fix:** add `upgrade` / `downgrade` commands, or remove the hint until they exist.

19. **The missing-option message names the wrong flag.** `$withDB` reports `-M <dbname>`; the option is `-N`.

20. **`confirmWaiver` clears an interval with `clearTimeout`.** It works in Node, where the two are interchangeable, but it reads like a bug. Use `clearInterval`.

## Library design

21. **Importing the library patches `Promise.prototype` and `Object.prototype`.** `Hacks.ts` adds `Promise.prototype.first` and `Object.prototype.isHigherOrder` globally, for every program that imports magic-orm. Nothing uses `isHigherOrder`.
    - **Intended fix:** delete `isHigherOrder`, and replace `.first()` with an exported `first(promise)` helper. That's a breaking change, so it belongs in v5 alongside the deprecated method removals.

22. **`Promise.prototype.first` replaces falsy fallbacks with `null`.** It returns `fallback || null`, so `first(0)` or `first('')` on an empty array yields `null`.
    - **Intended fix:** use `fallback ?? null`. Moot if #21 lands first.

23. **The update path needs `@ts-ignore` and `any`.** `Entity.update` carries two `@ts-ignore FIXME` comments and casts through `any`, and the library has 32 errors under `--strict`.
    - **Intended fix:** type the polymorphic update loop properly, then turn on `strict` in `tsconfig.json`.

24. **`Entity.getFields` crashes on an unknown field set.** When the field set doesn't exist and `allowNull` is false, `all` is `undefined` and `all.includes` throws a `TypeError` instead of an `ORMError`.

25. **A log message prints `{select}` literally.** In `Entity.read_parent`, the "Inefficient query" warning is missing a `$` before `{select}`.

## Testing

29. **No tests.** Nothing checks queries, serialization, transactions or code generation, which is how every entry above got in. See [TESTING.md](TESTING.md) once it exists.
    - **Intended fix:** start with unit tests for `Serializer` and the query builders (no database needed). Then add a system layer against a disposable Postgres for `atomic()` and inheritance reads, and golden-file tests for `Version.typescript`.

## Single source of truth
Places that keep their own copy of a fact owned elsewhere.

30. **The length of each UUID size is stated three times.** `Entity.UUID` (what is generated), `uuidmap` in `src-bin/Version.ts` (the `VARCHAR` width) and the comment on `UUIDSize` in `Structures.ts` each encode it separately. They agree today.
    - **Intended fix:** one exported table of sizes that both the generator and the CLI import.

31. **The `UUIDSize` union is duplicated.** `src-bin/Version.ts`'s `Model` type restates `"small"|"standard"|"long"|"huge"` instead of importing `UUIDSize`.

32. **The two-letter prefix length is hard-coded in three places.** `NS` in `Structures.ts`, `substring(3)` in `Entity.$ingest`, and the `[A-Z]{2}` alias regex in `DBUtil.validate`.

33. **`package-lock.json` disagrees with `package.json` on the package version.** The lock says `4.1.0-alpha.1`; `package.json` says `4.1.0-alpha.6`.
    - **Intended fix:** run `npm install` after each version bump, or bump with `npm version`, which updates both.
