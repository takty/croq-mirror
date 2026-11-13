# JS / TS Coding Style

## Formatting

* Use **tabs** for indentation.
* End statements with **semicolons**.
* Use **single quotes** for strings by default.
* Use template literals when interpolation or multiline strings are needed.
* Align related declarations vertically when it improves readability.

  * Align `:` in type annotations.
  * Align `=` in consecutive assignments.
  * Align object-property `:` where appropriate.
* Apply vertical alignment only within small, semantically related groups.
* Do not enforce a strict short line-length limit; long lines are acceptable when they form a coherent unit.
* Use trailing commas in multiline arrays, objects, imports, and parameter lists where appropriate.
* Separate logical sections with comments such as:

```ts
// -----------------------------------------------------------------------------
```

or:

```ts
// Domain settings -----------------------------------------------------------
```

## Naming

* Variables, functions, and methods: `camelCase`
* Classes and types: `PascalCase`
* Semantic constants: `UPPER_SNAKE_CASE`
* Files: lowercase `kebab-case`

  * Example: `domain-factory.ts`
  * Example: `transition-scroll.ts`
* Prefer descriptive names for public APIs.
* Short names are acceptable for local variables with narrow scope.

  * Examples: `i`, `v`, `c`, `d`, `vs`, `es`, `fs`, `ret`
* Short plural abbreviations are acceptable where the meaning is clear.

  * `vs`: vertices
  * `es`: edges
  * `fs`: faces

## Variables and Control Flow

* Prefer `const`.
* Use `let` only when reassignment is necessary.
* Do not use `var`.
* Prefer strict equality operators:

  * `===`
  * `!==`
* Use early returns to reduce nesting.
* A simple `if` statement may be written on one line.

```ts
if (value === null) return;
```

* Use braces when the conditional body contains multiple statements.

## TypeScript

* Prefer explicit type annotations, including for local variables when useful for readability.
* Explicitly specify function and method return types.
* Explicitly type parameters and default parameters.
* Use `type` for aliases and tuples where appropriate.
* `enum` is acceptable when it naturally represents the domain.
* Do not force `as const` as a replacement for `enum`.
* Prefer ECMAScript private fields and methods using `#`.

```ts
#value: number;

#getValue(): number {
	return this.#value;
}
```

* Getter/setter-style behavior may be expressed with explicit methods such as:

```ts
getValue()
setValue()
isEnabled()
doCheckSomething()
```

## Comments and Documentation

* **Write all code comments in English.**
* This applies to:

  * line comments
  * block comments
  * JSDoc
  * section headings
  * TODO/FIXME comments
* Do not mix Japanese comments into JS/TS source code unless explicitly required.
* Public classes, functions, and methods may use JSDoc with:

  * description
  * `@param`
  * `@returns`
* Library-style source files may include a header such as:

```ts
/**
 * Component Description
 *
 * @author Takuto Yanagida
 * @version YYYY-MM-DD
 */
```

## General Style

* Favor explicitness and readability over minimal syntax.
* Do not rely on Prettier-style automatic formatting when it destroys intentional vertical alignment.
* Preserve visually aligned declarations where they clarify structure.
* Keep public APIs descriptive while allowing compact notation inside algorithmic or mathematical code.
* Prefer code whose logical structure is visible from formatting alone.
