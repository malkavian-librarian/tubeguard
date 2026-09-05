import { describe, expect, test } from 'vitest';
import { authorizeMessage, validateLegacySetting } from '../background/message-authorization.js';

const id = 'test-extension';
const options = { id, url: `chrome-extension://${id}/src/options/options.html` };
const youtube = { id, url: 'https://www.youtube.com/watch?v=abcdefghijk', frameId: 0, tab: { id: 1 }, documentId: 'doc' };
describe('message authority', () => {
  test('content cannot read history, run analysis or save credentials', () => {
    for (const type of ['GET_HISTORY', 'RUN_ANALYSIS_NOW', 'SAVE_AI_SETTINGS', 'DELETE_AI_DATA']) {
      expect(() => authorizeMessage({ type }, youtube, id)).toThrow();
      expect(authorizeMessage({ type }, options, id)).toBe(true);
    }
  });
  test('capture is bound to top frame YouTube and this extension', () => {
    expect(authorizeMessage({ type: 'BEGIN_CAPTURE' }, youtube, id)).toBe(true);
    for (const sender of [{ ...youtube, frameId: 1 }, { ...youtube, id: 'foreign' }, { ...youtube, url: 'https://www.youtube.com.evil.test/watch' }, options]) {
      expect(() => authorizeMessage({ type: 'BEGIN_CAPTURE' }, sender, id)).toThrow();
    }
  });
  test('unknown messages and arbitrary generic settings are rejected', () => {
    expect(() => authorizeMessage({ type: 'BOGUS' }, options, id)).toThrow();
    for (const key of ['aiApiKey', 'blockedChannels', '__proto__', 'key']) {
      expect(() => validateLegacySetting({ key, value: 'secret' })).toThrow();
    }
    expect(validateLegacySetting({ key: 'enabled', value: false })).toBe(true);
    expect(() => validateLegacySetting({ key: 'enabled', value: 'false' })).toThrow();
  });
});
