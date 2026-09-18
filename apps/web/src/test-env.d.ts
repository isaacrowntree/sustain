// The web app types against the browser only. The test setup borrows
// Node's Blob (see test-setup.ts); this is the one Node module it needs.
declare module 'node:buffer' {
  export const Blob: typeof globalThis.Blob;
}
