import { describe, expect, test } from 'vitest';
import { parseTranscript } from '../content/transcript-adapter.js';

describe('parseTranscript', () => {
  test('normalizes JSON3 events and preserves timing', () => {
    const body = JSON.stringify({ events: [
      { tStartMs: 120, dDurationMs: 880, segs: [{ utf8: 'A & ' }, { utf8: '<B>' }] },
      { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: '\nNext' }] },
    ] });
    expect(parseTranscript({ format: 'json3', body })).toEqual({
      status: 'complete', language: '', source: 'captions-json3',
      segments: [
        { id: '0', startMs: 120, endMs: 1000, text: 'A & <B>' },
        { id: '1', startMs: 1000, endMs: 1500, text: 'Next' },
      ],
    });
  });

  test('parses XML entities without executing markup', () => {
    const value = parseTranscript({ format: 'xml', body: '<transcript><text start="1.5" dur="2">Tom &amp; &lt;b&gt;Ada&lt;/b&gt;</text></transcript>' });
    expect(value.segments).toEqual([{ id: '0', startMs: 1500, endMs: 3500, text: 'Tom & <b>Ada</b>' }]);
  });

  test('reports empty and malformed responses honestly', () => {
    expect(parseTranscript({ format: 'json3', body: '' }).status).toBe('unavailable');
    expect(parseTranscript({ format: 'json3', body: '{' }).status).toBe('unavailable');
  });
});
