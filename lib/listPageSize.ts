// Page sizes for the server-paginated list pages.
//
// These live in a plain module on purpose. Importing a const from a
// "use client" module into a server component does NOT give you the value —
// Next replaces that module's exports with client references, so the import
// arrives as a function and Prisma fails at request time with
// `take: [object Function], skip: NaN`. Typecheck and build both pass, because
// the breakage only exists at runtime.

export const CAMPAIGNS_PAGE_SIZE = 25;
export const CREATORS_PAGE_SIZE = 24;
