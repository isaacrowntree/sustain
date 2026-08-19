/** Session recordings (day-1 vs day-120) live in the local IndexedDB. */

import { idbGet, idbKeys, idbPut, RECORDINGS_STORE } from './idb.js';

export function saveRecording(key: string, blob: Blob): Promise<void> {
  return idbPut(RECORDINGS_STORE, key, blob);
}

export function loadRecording(key: string): Promise<Blob | null> {
  return idbGet<Blob>(RECORDINGS_STORE, key);
}

export function listRecordingKeys(): Promise<string[]> {
  return idbKeys(RECORDINGS_STORE);
}
