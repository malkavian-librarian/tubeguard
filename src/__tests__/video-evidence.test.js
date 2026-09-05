import { expect, test, vi } from 'vitest';
import { extractEvidence } from '../content/video-evidence.js';

function page(ownerHref = '/@owner') {
  document.body.textContent = '';
  const wrap = document.createElement('div'); wrap.id='owner';
  const name = document.createElement('div'); name.id='channel-name';
  const owner = document.createElement('a'); owner.href = ownerHref; owner.textContent = 'Owner';
  const title = document.createElement('h1'); title.textContent = 'Title';
  name.append(owner); wrap.append(name); document.body.append(wrap, title);
  return document;
}

test('uses matching player canonical channel identity and records provenance', async () => {
  const evidence = await extractEvidence({ document: page('/@owner'), videoId: 'aircAruvnKk', navigationId: 'nav-1', signal: new AbortController().signal,
    getPlayerMetadata: async () => ({ videoId: 'aircAruvnKk', channelId: 'UC1234567890123456789012', title: 'Player title', shortDescription: 'Description', author: 'Owner', lengthSeconds: '301', captionTracks: [] }) });
  expect(evidence.channelId).toBe('UC1234567890123456789012');
  expect(evidence.identityProvenance).toBe('active-player+owner-handle');
  expect(evidence.durationSeconds).toBe(301);
});

test('conflicting player and owner evidence retains video with null identity', async () => {
  const evidence = await extractEvidence({ document: page('/channel/UCaaaaaaaaaaaaaaaaaaaaaa'), videoId: 'aircAruvnKk', navigationId: 'nav-2', signal: new AbortController().signal,
    getPlayerMetadata: async () => ({ videoId: 'aircAruvnKk', channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb', lengthSeconds: 'NaN', captionTracks: [] }) });
  expect(evidence.channelId).toBeNull();
  expect(evidence.durationSeconds).toBeNull();
});

test('discards transcript that resolves after navigation is aborted', async () => {
  const controller = new AbortController();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const result = extractEvidence({ document: page(), videoId: 'aircAruvnKk', navigationId: 'old', signal: controller.signal,
    getPlayerMetadata: async () => ({ videoId: 'aircAruvnKk', captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=aircAruvnKk' }] }),
    fetchImpl: vi.fn(() => pending) });
  controller.abort(); finish({ ok: true, text: async () => '{"events":[]}' });
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});

test('never fetches oversized or non-timedtext caption URLs', async () => {
  const fetchImpl = vi.fn();
  const evidence = await extractEvidence({ document: page(), videoId: 'aircAruvnKk', navigationId: 'n', signal: new AbortController().signal,
    getPlayerMetadata: async () => ({ videoId: 'aircAruvnKk', shortDescription: 'x'.repeat(40000), captionTracks: [{ baseUrl: 'https://evil.example/captions' }] }), fetchImpl });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(evidence.description.length).toBe(32768);
  expect(evidence.transcript.status).toBe('partial');
});
