import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

test('local Rocketbox asset is a self-contained GLB with all required mouth shapes', () => {
  const bytes = readFileSync('public/avatars/interviewer.glb');
  assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  assert.ok(gltf.buffers.every((buffer: { uri?: string }) => !buffer.uri));
  assert.ok((gltf.images ?? []).every((image: { uri?: string }) => !image.uri || image.uri.startsWith('data:')));
  const names = gltf.meshes.flatMap((mesh: { extras?: { targetNames?: string[] } }) => mesh.extras?.targetNames ?? []);
  for (const name of ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U']) {
    assert.ok(names.includes(`viseme_${name}`), `Missing mouth shape viseme_${name}`);
  }
  console.log('Rocketbox SHA-256:', createHash('sha256').update(bytes).digest('hex'));
});
