import test from 'node:test';
import assert from 'node:assert/strict';
import { ownBase, ownHosts } from '../src/origin.js';

const req = host => ({ get: k => (k === 'host' ? host : undefined), protocol: 'http' });

test('Sign-in finishes on our own address, never on a stranger\'s', () => {
  Object.assign(process.env, { PUBLIC_URL: 'https://app.example.com', APP_HOSTS: 'spare.example.org,demo.example.net' });
  try {
    assert.deepEqual(ownHosts().sort(), ['app.example.com', 'demo.example.net', 'spare.example.org']);
    assert.equal(ownBase(req('app.example.com')), 'https://app.example.com');
    assert.equal(ownBase(req('DEMO.example.net')), 'https://demo.example.net');
    assert.equal(ownBase(req('spare.example.org')), 'https://spare.example.org');
    assert.equal(ownBase(req('localhost:3000')), 'http://localhost:3000');
    assert.equal(ownBase(req('evil.example.net')), null);
    assert.equal(ownBase(req('')), null);
  } finally { for (const k of ['PUBLIC_URL', 'APP_HOSTS']) delete process.env[k]; }
});
