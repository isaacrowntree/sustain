// A real IndexedDB implementation in memory, so the storage layer runs as
// written instead of being stubbed around.
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';

// fake-indexeddb clones values with Node's structuredClone, which doesn't
// know jsdom's Blob and hands back an empty object. Browsers clone Blobs
// natively; Node's Blob is the closest stand-in that survives the trip.
globalThis.Blob = NodeBlob as unknown as typeof Blob;
