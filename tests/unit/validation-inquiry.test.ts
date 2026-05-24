import { describe, expect, it } from 'vitest';
import { fixedClock } from '@/lib/clock';
import {
  validateContactSubmission,
  validateCommissionSubmission,
  PROJECT_TYPES,
  NAME_MAX,
  EMAIL_MAX,
  SUBJECT_MAX,
  CONTACT_MESSAGE_MIN,
  CONTACT_MESSAGE_MAX,
  COMMISSION_DESCRIPTION_MIN,
  COMMISSION_DESCRIPTION_MAX,
} from '@/lib/validation/inquiry';
import type { FieldError } from '@/lib/types/inquiry';

const TODAY = new Date('2025-06-15T00:00:00.000Z');

function codes(errors: ReadonlyArray<FieldError>): Array<[string, string]> {
  return errors.map((e) => [e.field, e.code]);
}

describe('validateContactSubmission', () => {
  const valid = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    subject: 'Hello',
    message: 'Loved your portfolio!',
  };

  it('accepts a fully valid submission and returns the narrowed value', () => {
    const result = validateContactSubmission(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(valid);
    }
  });

  it('rejects a non-object input with required errors for every field', () => {
    const result = validateContactSubmission(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(
        expect.arrayContaining([
          ['name', 'required'],
          ['email', 'required'],
          ['subject', 'required'],
          ['message', 'required'],
        ]),
      );
    }
  });

  it('flags whitespace-only required fields as required', () => {
    const result = validateContactSubmission({
      ...valid,
      name: '   ',
      subject: '\t\n',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(
        expect.arrayContaining([
          ['name', 'required'],
          ['subject', 'required'],
        ]),
      );
    }
  });

  it('reports email_invalid for malformed addresses', () => {
    for (const bad of [
      'no-at-sign',
      'foo@',
      '@example.com',
      'foo@bar',
      'foo@@bar.com',
      'foo @bar.com',
      'foo@bar..com',
    ]) {
      const result = validateContactSubmission({ ...valid, email: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(codes(result.errors)).toContainEqual(['email', 'email_invalid']);
      }
    }
  });

  it('accepts representative RFC 5322 valid addresses', () => {
    for (const good of [
      'a@b.co',
      'first.last@example.com',
      'user+tag@sub.example.co.uk',
      "o'mally@example.com",
      'name_with_underscore@example.io',
    ]) {
      const result = validateContactSubmission({ ...valid, email: good });
      expect(result.ok).toBe(true);
    }
  });

  it('reports length_max when email exceeds 254 characters', () => {
    const local = 'a'.repeat(EMAIL_MAX); // local-part alone exceeds 254
    const result = validateContactSubmission({
      ...valid,
      email: `${local}@example.com`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContainEqual(['email', 'length_max']);
    }
  });

  it('reports length bounds for name, subject, and message', () => {
    const result = validateContactSubmission({
      name: 'a'.repeat(NAME_MAX + 1),
      email: 'ok@example.com',
      subject: 's'.repeat(SUBJECT_MAX + 1),
      message: 'x'.repeat(CONTACT_MESSAGE_MIN - 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(
        expect.arrayContaining([
          ['name', 'length_max'],
          ['subject', 'length_max'],
          ['message', 'length_min'],
        ]),
      );
    }
  });

  it('rejects messages over the 5000-character cap', () => {
    const result = validateContactSubmission({
      ...valid,
      message: 'x'.repeat(CONTACT_MESSAGE_MAX + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContainEqual(['message', 'length_max']);
    }
  });

  it('accepts boundary lengths exactly at the bounds', () => {
    const result = validateContactSubmission({
      name: 'a',
      email: 'a@b.co',
      subject: 's',
      message: 'x'.repeat(CONTACT_MESSAGE_MIN),
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateCommissionSubmission', () => {
  const valid = {
    name: 'Grace Hopper',
    email: 'grace@example.com',
    projectType: 'Character',
    budgetRangeId: 'budget-mid',
    targetDeadline: '2025-07-01',
    description: 'Need a stylized character with full rig and turntable.',
  };

  it('accepts a fully valid submission with a Date "today"', () => {
    const result = validateCommissionSubmission(valid, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.projectType).toBe('Character');
      expect(result.value.budgetRangeId).toBe('budget-mid');
      expect(result.value.targetDeadline).toBe('2025-07-01');
    }
  });

  it('accepts a Clock as the "today" source', () => {
    const clock = fixedClock(TODAY);
    const result = validateCommissionSubmission(valid, clock);
    expect(result.ok).toBe(true);
  });

  it('treats deadline equal to today as valid (boundary)', () => {
    const result = validateCommissionSubmission(
      { ...valid, targetDeadline: '2025-06-15' },
      TODAY,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a deadline strictly before today with deadline_past', () => {
    const result = validateCommissionSubmission(
      { ...valid, targetDeadline: '2025-06-14' },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContainEqual([
        'targetDeadline',
        'deadline_past',
      ]);
    }
  });

  it('rejects a malformed deadline with date_invalid', () => {
    for (const bad of ['2025-13-01', '2025-02-30', 'tomorrow', '2025/06/15', '2025-6-1']) {
      const result = validateCommissionSubmission(
        { ...valid, targetDeadline: bad },
        TODAY,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(codes(result.errors)).toContainEqual([
          'targetDeadline',
          'date_invalid',
        ]);
      }
    }
  });

  it('reports enum_invalid when projectType is not in the enum', () => {
    const result = validateCommissionSubmission(
      { ...valid, projectType: 'Sculpture' },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContainEqual([
        'projectType',
        'enum_invalid',
      ]);
    }
  });

  it('accepts every documented project type option', () => {
    for (const projectType of PROJECT_TYPES) {
      const result = validateCommissionSubmission(
        { ...valid, projectType },
        TODAY,
      );
      expect(result.ok).toBe(true);
    }
  });

  it('reports required when budgetRangeId is empty', () => {
    const result = validateCommissionSubmission(
      { ...valid, budgetRangeId: '' },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContainEqual([
        'budgetRangeId',
        'required',
      ]);
    }
  });

  it('reports description bounds (20..5000)', () => {
    const tooShort = validateCommissionSubmission(
      { ...valid, description: 'x'.repeat(COMMISSION_DESCRIPTION_MIN - 1) },
      TODAY,
    );
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) {
      expect(codes(tooShort.errors)).toContainEqual([
        'description',
        'length_min',
      ]);
    }

    const tooLong = validateCommissionSubmission(
      { ...valid, description: 'x'.repeat(COMMISSION_DESCRIPTION_MAX + 1) },
      TODAY,
    );
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(codes(tooLong.errors)).toContainEqual([
        'description',
        'length_max',
      ]);
    }
  });

  it('reports every violation at once when multiple fields are invalid', () => {
    const result = validateCommissionSubmission(
      {
        name: '',
        email: 'not-an-email',
        projectType: 'Banana',
        budgetRangeId: '',
        targetDeadline: '2024-01-01',
        description: 'too short',
      },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const pairs = codes(result.errors);
      expect(pairs).toEqual(
        expect.arrayContaining([
          ['name', 'required'],
          ['email', 'email_invalid'],
          ['projectType', 'enum_invalid'],
          ['budgetRangeId', 'required'],
          ['targetDeadline', 'deadline_past'],
          ['description', 'length_min'],
        ]),
      );
    }
  });

  it('compares dates at calendar-day granularity in UTC, ignoring time-of-day', () => {
    // Late on the deadline date (UTC) is still valid.
    const lateInDay = new Date('2025-07-01T23:59:59.999Z');
    const result = validateCommissionSubmission(valid, lateInDay);
    expect(result.ok).toBe(true);
  });
});
