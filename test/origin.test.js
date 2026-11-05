import test from 'node:test';
import assert from 'node:assert/strict';
import { ownBase, ownHosts } from '../src/origin.js';

const req = host => ({ get: k => (k === 'host' ? host : undefined), protocol: 'http' });

test('Sign-in finishes on our own address, never on a stranger\'s', () => {
  Object.assign(process.env, { PUBLIC_URL: 'https://app.example.com', RENDER_EXTERNAL_HOSTNAME: 'demo.onrender.com', APP_HOSTS: 'spare.example.org' });
  try {
    assert.deepEqual(ownHosts().sort(), ['app.example.com', 'demo.onrender.com', 'spare.example.org']);
    assert.equal(ownBase(req('app.example.com')), 'https://app.example.com');
    assert.equal(ownBase(req('DEMO.onrender.com')), 'https://demo.onrender.com');
    assert.equal(ownBase(req('spare.example.org')), 'https://spare.example.org');
    assert.equal(ownBase(req('localhost:3000')), 'http://localhost:3000');
    assert.equal(ownBase(req('evil.example.net')), null);
    assert.equal(ownBase(req('')), null);
  } finally { for (const k of ['PUBLIC_URL', 'RENDER_EXTERNAL_HOSTNAME', 'APP_HOSTS']) delete process.env[k]; }
});
