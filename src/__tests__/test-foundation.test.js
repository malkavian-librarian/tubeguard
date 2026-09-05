import { afterEach, describe, expect, test, vi } from 'vitest';

import { installChromeMock, resetChromeMock } from './helpers/chrome.js';
import automaticMultilingual from './fixtures/youtube/captioned-automatic-multilingual.json';
import humanCaptioned from './fixtures/youtube/captioned-human.json';
import liveDuration from './fixtures/youtube/live-duration.json';
import noCaptions from './fixtures/youtube/no-captions.json';
import staleSpa from './fixtures/youtube/stale-spa.json';
import advertisement from './fixtures/youtube/advertisement.json';

afterEach(() => {
  resetChromeMock();
});

describe('Chrome test harness', () => {
  test('persists storage writes and emits a complete change record', async () => {
    const chrome = installChromeMock({ sync: { enabled: false } });
    const listener = vi.fn();
    chrome.storage.onChanged.addListener(listener);

    await chrome.storage.sync.set({ enabled: true, priorities: 'Learn Spanish' });

    await expect(chrome.storage.sync.get(null)).resolves.toEqual({
      enabled: true,
      priorities: 'Learn Spanish',
    });
    expect(listener).toHaveBeenCalledWith({
      enabled: { oldValue: false, newValue: true },
      priorities: { oldValue: undefined, newValue: 'Learn Spanish' },
    }, 'sync');
  });

  test('supports callback Chrome APIs and resets global state', () => {
    const chrome = installChromeMock({ local: { keySlot: 'dummy-key' } });
    const callback = vi.fn();

    chrome.storage.local.get('keySlot', callback);

    expect(callback).toHaveBeenCalledWith({ keySlot: 'dummy-key' });
    resetChromeMock();
    expect(globalThis.chrome).toBeUndefined();
  });
});

describe('synthetic YouTube fixture integrity', () => {
  test.each([
    ['human caption', humanCaptioned, 'human', 'en'],
    ['automatic multilingual caption', automaticMultilingual, 'asr', 'es'],
  ])('%s has canonical owner identity and bounded transcript evidence', (_name, fixture, kind, language) => {
    expect(fixture.videoId).toMatch(/^[\w-]{11}$/);
    expect(fixture.owner.channelId).toMatch(/^UC[\w-]{22}$/);
    expect(fixture.owner.href).toBe(`/channel/${fixture.owner.channelId}`);
    expect(fixture.player.captions[0]).toMatchObject({ kind, language });
    expect(fixture.player.captions[0].url).toMatch(/^https:\/\/www\.youtube\.com\/api\/timedtext\?/);
    expect(fixture.transcript.segments.length).toBeGreaterThan(0);
    expect(fixture.transcript.segments.every(({ startMs, endMs, text }) => (
      Number.isInteger(startMs) && endMs > startMs && text.length > 0
    ))).toBe(true);
  });

  test('edge fixtures distinguish unavailable, stale, advertisement, and live states', () => {
    for (const fixture of [noCaptions, staleSpa, advertisement, liveDuration]) {
      expect(fixture.owner.channelId).toMatch(/^UC[\w-]{22}$/);
    }
    expect(noCaptions.player.captions).toEqual([]);
    expect(staleSpa.activeVideoId).not.toBe(staleSpa.player.videoId);
    expect(advertisement.player.adPlaying).toBe(true);
    expect(liveDuration.player.durationSeconds).toBeNull();
    expect(liveDuration.player.isLive).toBe(true);
  });
});
