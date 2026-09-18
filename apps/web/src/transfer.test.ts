import { beforeEach, describe, expect, it, vi } from 'vitest';
import { didgeridooPack as pack } from '@sustain/pack-didgeridoo';
import { emptyProgress, recordSession } from '@sustain/core';
import { IndexedDBProgressStore } from './state.js';
import { listRecordingKeys, loadRecording, saveRecording } from './recordings.js';
import {
  base64ToBlob,
  blobBytes,
  blobToBase64,
  buildExportBundle,
  EXPORT_VERSION,
  importProgress,
  validateBundle,
  type ExportBundle,
} from './transfer.js';

const P = pack.id;
const BASELINE_KEY = `${P}:2026-08-24:baseline-recording`;

function sampleState() {
  const state = emptyProgress(P, '2026-08-24');
  recordSession(state, {
    date: '2026-08-24',
    dayIndex: 0,
    completedSeconds: 900,
    playSeconds: 600,
    verified: true,
    isBoss: false,
    completedDrillIds: ['baseline-recording', 'first-drone'],
    counted: true,
  });
  return state;
}

async function wipe(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('sustain');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blobBytes(blob))];
}

beforeEach(wipe);

describe('export', () => {
  it('produces a versioned bundle with the pack recordings inline', async () => {
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 255, 128]);
    await saveRecording(BASELINE_KEY, new Blob([audio], { type: 'audio/webm;codecs=opus' }));
    await saveRecording('trombone:2026-08-24:baseline-recording', new Blob([audio], { type: 'audio/webm' }));

    const state = sampleState();
    const bundle = await buildExportBundle(state, undefined, new Date('2026-09-18T10:00:00Z'));

    expect(bundle.version).toBe(1);
    expect(bundle.exportedAt).toBe('2026-09-18T10:00:00.000Z');
    expect(bundle.progress).toEqual(state);
    expect(bundle.recordings).toHaveLength(1);
    expect(bundle.recordings[0]).toMatchObject({ key: BASELINE_KEY, mimeType: 'audio/webm;codecs=opus' });
    expect(bundle.recordings[0]?.base64).toBe(btoa(String.fromCharCode(...audio)));
    // It survives the trip through JSON as a single file.
    const roundTrip = JSON.parse(JSON.stringify(bundle)) as ExportBundle;
    expect(roundTrip).toEqual(bundle);
  });

  it('base64 round-trips bytes and mime type', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    const blob = new Blob([bytes], { type: 'audio/ogg' });
    const back = base64ToBlob(await blobToBase64(blob), blob.type);
    expect(back.type).toBe('audio/ogg');
    expect(await bytesOf(back)).toEqual([...bytes]);
  });
});

describe('import', () => {
  const fileOf = (data: unknown) => new Blob([JSON.stringify(data)], { type: 'application/json' });

  it('rejects the wrong version and non-bundles', async () => {
    const store = new IndexedDBProgressStore(P);
    const deps = { packId: P, store, confirmOverwrite: () => true };

    const v2 = await importProgress(fileOf({ version: 2, progress: sampleState(), recordings: [] }), deps);
    expect(v2).toMatchObject({ ok: false, reason: 'invalid' });
    expect(v2.ok === false && v2.message).toMatch(/version 2/);

    const plain = await importProgress(fileOf(sampleState()), deps);
    expect(plain).toMatchObject({ ok: false, reason: 'invalid' });

    const junk = await importProgress(new Blob(['not json']), deps);
    expect(junk).toMatchObject({ ok: false, reason: 'invalid' });

    expect(validateBundle({ version: EXPORT_VERSION, progress: { version: 1 }, recordings: [] })).toHaveProperty('error');
    expect(await store.load()).toBeNull();
  });

  it('refuses a bundle for another pack', async () => {
    const store = new IndexedDBProgressStore(P);
    const other = { ...sampleState(), packId: 'trombone' };
    const r = await importProgress(fileOf({ version: 1, exportedAt: '', progress: other, recordings: [] }), {
      packId: P,
      store,
      confirmOverwrite: () => true,
    });
    expect(r).toMatchObject({ ok: false, reason: 'wrong-pack' });
  });

  it('round-trips progress and a recording through export and import', async () => {
    const audio = new Uint8Array([1, 2, 3, 250, 251, 252]);
    await saveRecording(BASELINE_KEY, new Blob([audio], { type: 'audio/webm' }));
    const state = sampleState();
    const bundle = await buildExportBundle(state);
    await wipe();

    const store = new IndexedDBProgressStore(P);
    const confirm = vi.fn(() => true);
    const r = await importProgress(fileOf(bundle), { packId: P, store, confirmOverwrite: confirm });

    expect(r).toMatchObject({ ok: true, recordingsRestored: 1 });
    expect(confirm).not.toHaveBeenCalled(); // nothing to overwrite on a fresh browser
    expect(await store.load()).toEqual(state);
    expect(await listRecordingKeys()).toEqual([BASELINE_KEY]);
    const restored = await loadRecording(BASELINE_KEY);
    expect(restored?.type).toBe('audio/webm');
    expect(await bytesOf(restored!)).toEqual([...audio]);
  });

  it('does not overwrite existing progress unless confirmed', async () => {
    const store = new IndexedDBProgressStore(P);
    const existing = emptyProgress(P, '2026-06-01');
    await store.save(existing);
    const bundle: ExportBundle = { version: 1, exportedAt: '', progress: sampleState(), recordings: [] };

    const declined = await importProgress(fileOf(bundle), { packId: P, store, confirmOverwrite: () => false });
    expect(declined).toMatchObject({ ok: false, reason: 'refused' });
    expect(await store.load()).toEqual(existing);

    const confirm = vi.fn(async () => true);
    const accepted = await importProgress(fileOf(bundle), { packId: P, store, confirmOverwrite: confirm });
    expect(accepted.ok).toBe(true);
    expect(confirm).toHaveBeenCalledWith(existing);
    expect((await store.load())?.startDate).toBe('2026-08-24');
  });
});
