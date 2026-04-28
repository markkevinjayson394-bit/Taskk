import { safeParseObject } from '../../utils/parsing';

describe('safeParseObject', () => {
  it('parses valid JSON', () =>
    expect(safeParseObject('{"a":1}')).toEqual({ a: 1 }));

  it('returns null for invalid JSON', () =>
    expect(safeParseObject('bad')).toBeNull());

  it('returns null for null', () =>
    expect(safeParseObject(null)).toBeNull());

  it('returns null for empty string', () =>
    expect(safeParseObject('')).toBeNull());
});
