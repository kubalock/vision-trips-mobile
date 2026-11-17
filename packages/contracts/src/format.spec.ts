import { describe, expect, it } from 'vitest';
import { formatPoints, maskDocumentNumber, maskEmail, normalizeTerminal, passportExpiresTooSoon, terminalFromNotes } from './format.js';

describe('maskEmail', () => {
  it('shows only the first and last letter with a fixed-length mask', () => {
    expect(maskEmail('dorota@yahoo.com')).toBe('d•••a@yahoo.com');
    expect(maskEmail('averyveryverylongname@example.com')).toBe('a•••e@example.com');
    expect(maskEmail('jo@example.com')).toBe('j•••@example.com');
    expect(maskEmail('not-an-email')).toBeNull();
    expect(maskEmail('')).toBeNull();
  });
});

describe('maskDocumentNumber', () => {
  it('keeps the last three characters only', () => {
    expect(maskDocumentNumber('123456876')).toBe('···876');
    expect(maskDocumentNumber('ab 12')).toBe('···B12');
    expect(maskDocumentNumber('12')).toBeNull();
    expect(maskDocumentNumber(null)).toBeNull();
  });
});

describe('normalizeTerminal', () => {
  it.each([['5', 'T5'], ['T5', 'T5'], ['t 5', 'T5'], ['Terminal 5', 'T5'], ['2A', 'T2A'], ['terminal 2a', 'T2A'], ['North', 'North'], ['South Terminal', 'South'], [5, 'T5']])('%s → %s', (input, expected) => {
    expect(normalizeTerminal(input)).toBe(expected);
  });
  it.each([[''], ['Please check in three hours before'], ['Gate 12'], [null], [undefined], ['Mars']])('rejects %s', (input) => {
    expect(normalizeTerminal(input)).toBeNull();
  });
});

describe('terminalFromNotes', () => {
  it('reads departure and arrival terminals from text', () => {
    expect(terminalFromNotes('Please check in at Terminal 3 two hours before.', 'departure')).toBe('T3');
    expect(terminalFromNotes('Flight arrives Terminal 1 at 14:05', 'arrival')).toBe('T1');
    expect(terminalFromNotes('Flight arrives Terminal 1 at 14:05', 'departure')).toBeNull();
  });
  it('gives up when the text names two different terminals', () => {
    expect(terminalFromNotes('Check in at Terminal 2, or check in at Terminal 3 for groups', 'departure')).toBeNull();
  });
});

describe('formatPoints', () => {
  it('uses singular and plural correctly', () => {
    expect(formatPoints(1)).toBe('1 point');
    expect(formatPoints(2500)).toBe('2,500 points');
    expect(formatPoints(0)).toBe('0 points');
  });
});

describe('passportExpiresTooSoon', () => {
  it('warns within six months after the return date', () => {
    expect(passportExpiresTooSoon('2027-09-01', '2027-05-08')).toBe(true);
    expect(passportExpiresTooSoon('2027-11-09', '2027-05-08')).toBe(false);
    expect(passportExpiresTooSoon(null, '2027-05-08')).toBe(false);
  });
});
