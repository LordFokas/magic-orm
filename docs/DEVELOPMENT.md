# magic-orm - Development Guide

For people working on magic-orm itself, or building on top of it. How to use it is in [MAGIC-ORM.md](MAGIC-ORM.md); how we work is in [METHODOLOGY.md](METHODOLOGY.md).

## Repository layout
| Path | Purpose |
|---|---|

## Architecture

### Entity classes are not the model
The model is the spec. Entity classes are the ORM's access layer: each one represents one piece of the model, not the model itself. So a model spec can extend another model as deeply as it likes, but every generated model class extends `Entity` directly. Always: no generated or hand-written model class extends another model class.

A class gets the common functionality it needs from `Entity` and all of its behavior configuration from `$config`. That is where the inheritance actually lives, fully data-driven. `Version.typescript` turns a spec's `extends` into:
- interface inheritance between the generated types (`T_Child extends T_Parent`), so instances are typed with all inherited fields;
- `$config.inherits` and `$config.chain`, which `Entity` follows at runtime (through `EntityMapper` lookups) to insert into, update and join the parent tables.

**Why:** `Entity`'s query methods are static, with `this` bound to the model class. Static inheritance is uncommon, unorthodox and non-standard, and it sets traps for an OOP developer who isn't expecting it. If one model class extended another, every static it didn't redeclare (config, caches, hooks) would come from the parent through the prototype chain. For example, a cache written as `this.x === undefined ? (this.x = …)` would silently hand the parent's value to the child. Keeping every class one level below `Entity` means a single, shallow level of static inheritance, the same for every model.

### "Is a" means exact type
Identity checks compare exact constructors (`obj.constructor !== this`, `name_of(value.constructor)`), not `instanceof`. A check that has to take inheritance or polymorphism into account consults the data-driven model (`$config.inherits`) explicitly.

**Why:** simplicity, and it makes the most common comparison as cheap as possible. Unlike the rule above, this one may be revisited later if a need arises.

## Build, run, package
| Command | What it does |
|---|---|

## Testing
See [TESTING.md](TESTING.md) for the test layers, how to run them and the rules for adding tests.

## Known limitations (accepted)
Things we know about and have decided to live with. Issues we want to fix are tracked in [PROBLEMS.md](PROBLEMS.md).

- **Importing the library adds `Promise.prototype.first`.** `Hacks.ts` patches it globally, for every program that imports magic-orm. **Why:** the convenience of `await Model.read(...).first()` is part of the library's API and stays. The global pollution may be engineered away later, but not at the cost of the `.first()` call style.
- **Booleans must be stored in native `BOOLEAN` columns.** Values go to Postgres as-is and come back as `pg` returns them; there is no conversion layer (it was removed along with the library's MySQL origins). The spec's `types` entry for `boolean` should map to `BOOLEAN`.
- **The serializer's entity registry is keyed by `constructor.name`.** `Serializer.register` and `toObject` look classes up by their JavaScript name, so minifying the code breaks the lookup and two classes with the same name in different modules overwrite each other. **Why:** <to confirm with the maintainer>.
- **Every `?` in a query is a placeholder.** `DBUtil.validate` and `DBUtil.pgps` treat each `?` as a parameter, including those inside string literals and Postgres's JSONB operators (`?`, `?|`, `?&`). **Why:** we don't use JSONB. Pass literals as parameters.
- **Identifiers and raw fragments go into SQL unchecked.** Values are parameterized, but column names (`Filter.col`), `FilterVal.val` (a deliberate raw-SQL escape hatch), `SelectBuilder.order`, `Connection.schema()` and the CLI's `-S` schema are written into the query text as given. They must only ever come from trusted code, never from user input. **Why:** <to confirm with the maintainer>.
