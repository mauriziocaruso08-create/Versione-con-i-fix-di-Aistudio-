import { parseItalianReminder } from './src/utils/reminderManager';

const now = new Date(2026, 9, 4, 12, 0, 0);
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

const a = parseItalianReminder('ricordami di chiamare Luca tra 2 giorni', now);
assert(a.dueAt && a.dueAt.getDate() === 6, 'relative days parsing failed');
assert(a.reminderText === 'chiamare Luca', 'relative days text extraction failed');

const b = parseItalianReminder('ricordami di chiamare Luca fra mezzora', now);
assert(b.dueAt && b.dueAt.getTime() === now.getTime() + 30*60*1000, 'fra mezzora failed');

const c = parseItalianReminder('ricordami il 31 febbraio 2027 alle 10', now);
assert(c.ambiguous === true, 'invalid calendar date accepted');

const d = parseItalianReminder('ricordami di chiamare Luca alle 20', now);
assert(d.dueAt && d.reminderText === 'chiamare Luca', 'same-day future reminder failed');

console.log('V6.7 hardening: 4/4 tests passed');
