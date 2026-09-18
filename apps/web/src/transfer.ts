/**
 * Data ownership: everything Sustain knows about you fits in one JSON file
 * that you can carry to another browser. Progress is small; recordings are
 * the bulk, carried inline as base64 so the export stays a single file.
 */

import type { ProgressState, ProgressStore } from '@sustain/core';
import { listRecordingKeys, loadRecording, saveRecording } from './recordings.js';

export const EXPORT_VERSION = 1;

export interface ExportedRecording {
  key: string;
  mimeType: string;
  base64: string;
}

export interface ExportBundle {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  progress: ProgressState;
  recordings: ExportedRecording[];
}

/** Recording storage, injectable so import/export can run without IndexedDB. */
export interface RecordingIO {
  listKeys(): Promise<string[]>;
  load(key: string): Promise<Blob | null>;
  save(key: string, blob: Blob): Promise<void>;
}

const defaultRecordingIO: RecordingIO = {
  listKeys: listRecordingKeys,
  load: loadRecording,
  save: saveRecording,
};

/** Blob bytes, via the promise API where it exists and FileReader where it doesn't. */
export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Blob as text, with the same fallback. */
export function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blobBytes(blob));
  // btoa wants a binary string; build it in chunks so a 30 s recording
  // doesn't blow the argument limit of String.fromCharCode.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Everything for one pack: its progress and every recording keyed to it. */
export async function buildExportBundle(
  state: ProgressState,
  io: RecordingIO = defaultRecordingIO,
  now: Date = new Date(),
): Promise<ExportBundle> {
  const keys = (await io.listKeys()).filter((k) => k.startsWith(`${state.packId}:`)).sort();
  const recordings: ExportedRecording[] = [];
  for (const key of keys) {
    const blob = await io.load(key);
    if (!blob || blob.size === 0) continue;
    recordings.push({ key, mimeType: blob.type, base64: await blobToBase64(blob) });
  }
  return { version: EXPORT_VERSION, exportedAt: now.toISOString(), progress: state, recordings };
}

/** The bundle as a downloadable JSON blob URL. Revoke it when the download starts. */
export async function exportProgress(state: ProgressState, io: RecordingIO = defaultRecordingIO): Promise<string> {
  const bundle = await buildExportBundle(state, io);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  return URL.createObjectURL(blob);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The shape the home screen and the core's adherence maths read from a
 * session: a date to place it on the calendar, a day index to place it in
 * the programme, and the numbers the tallies add up. The optional fields
 * are checked only when present, as older exports may lack them.
 */
function isSessionRecord(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.date !== 'string' || typeof v.dayIndex !== 'number') return false;
  if (typeof v.completedSeconds !== 'number' || typeof v.playSeconds !== 'number') return false;
  if (typeof v.verified !== 'boolean' || typeof v.isBoss !== 'boolean') return false;
  if (v.completedDrillIds !== undefined) {
    if (!Array.isArray(v.completedDrillIds) || !v.completedDrillIds.every((id) => typeof id === 'string')) return false;
  }
  if (v.counted !== undefined && typeof v.counted !== 'boolean') return false;
  return true;
}

/**
 * Check a parsed file is a bundle this build can read. Returns the reason
 * it isn't, or null when it is — the caller turns that into a message.
 */
export function validateBundle(data: unknown): { bundle: ExportBundle } | { error: string } {
  if (!isRecord(data)) return { error: 'This file is not a Sustain export.' };
  if (data.version !== EXPORT_VERSION) {
    return {
      error:
        typeof data.version === 'number'
          ? `This export is version ${data.version}; this build reads version ${EXPORT_VERSION}.`
          : 'This file is not a Sustain export (no version).',
    };
  }
  const progress = data.progress;
  if (
    !isRecord(progress) ||
    progress.version !== 1 ||
    typeof progress.packId !== 'string' ||
    typeof progress.startDate !== 'string' ||
    !Array.isArray(progress.sessions) ||
    !isRecord(progress.bests) ||
    !isRecord(progress.history) ||
    !isRecord(progress.drillCompletions) ||
    !isRecord(progress.selfReports)
  ) {
    return { error: 'The progress in this export is malformed.' };
  }
  const badSession = progress.sessions.findIndex((s) => !isSessionRecord(s));
  if (badSession !== -1) {
    return { error: `Session ${badSession + 1} in this export's progress is malformed.` };
  }
  const recordings = data.recordings ?? [];
  if (!Array.isArray(recordings)) return { error: 'The recordings in this export are malformed.' };
  for (const r of recordings) {
    if (!isRecord(r) || typeof r.key !== 'string' || typeof r.mimeType !== 'string' || typeof r.base64 !== 'string') {
      return { error: 'A recording in this export is malformed.' };
    }
  }
  return {
    bundle: {
      version: EXPORT_VERSION,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
      progress: progress as unknown as ProgressState,
      recordings: recordings as ExportedRecording[],
    },
  };
}

export interface ImportDeps {
  /** The pack this app is running; a bundle for another pack is refused. */
  packId: string;
  store: ProgressStore;
  /** Asked only when there is existing progress that the import would replace. */
  confirmOverwrite(existing: ProgressState): boolean | Promise<boolean>;
  recordings?: RecordingIO;
}

export type ImportResult =
  | { ok: true; state: ProgressState; recordingsRestored: number }
  | { ok: false; reason: 'invalid' | 'refused' | 'wrong-pack'; message: string };

/**
 * Restore a bundle: progress into the progress store, recordings back into
 * the recordings store. Existing progress is never silently replaced.
 *
 * The import is all-or-nothing as far as validation goes: every recording
 * is decoded and the progress checked before a single byte is written, so
 * a corrupt file leaves the browser exactly as it was. A storage failure
 * partway through the writes is rethrown with what had been written so far;
 * it cannot be rolled back, but it is never swallowed.
 */
export async function importProgress(file: Blob, deps: ImportDeps): Promise<ImportResult> {
  const io = deps.recordings ?? defaultRecordingIO;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await blobText(file));
  } catch {
    return { ok: false, reason: 'invalid', message: 'This file is not valid JSON.' };
  }
  const checked = validateBundle(parsed);
  if ('error' in checked) return { ok: false, reason: 'invalid', message: checked.error };
  const { bundle } = checked;

  if (bundle.progress.packId !== deps.packId) {
    return {
      ok: false,
      reason: 'wrong-pack',
      message: `This export is for the "${bundle.progress.packId}" pack; this app is running "${deps.packId}".`,
    };
  }

  const existing = await deps.store.load();
  if (existing && !(await deps.confirmOverwrite(existing))) {
    return { ok: false, reason: 'refused', message: 'Import cancelled; your existing progress is untouched.' };
  }

  // Decode everything first: a bad string anywhere means nothing is written.
  const decoded: { key: string; blob: Blob }[] = [];
  for (const r of bundle.recordings) {
    if (!r.key.startsWith(`${deps.packId}:`)) continue;
    let blob: Blob;
    try {
      blob = base64ToBlob(r.base64, r.mimeType);
    } catch {
      throw new Error(`recording ${r.key} is not valid base64`);
    }
    decoded.push({ key: r.key, blob });
  }

  let restored = 0;
  try {
    for (const { key, blob } of decoded) {
      await io.save(key, blob);
      restored++;
    }
    await deps.store.save(bundle.progress);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Import failed while writing to storage (${restored} of ${decoded.length} recordings written, progress not saved): ${detail}`,
      { cause },
    );
  }
  return { ok: true, state: bundle.progress, recordingsRestored: restored };
}
