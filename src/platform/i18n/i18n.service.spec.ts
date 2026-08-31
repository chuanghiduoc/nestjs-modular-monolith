import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '#shared/errors';

import { DEFAULT_LOCALE, I18nService } from './i18n.service';

describe('I18nService', () => {
  it('resolves supported language tags and falls back safely', () => {
    const i18n = new I18nService();

    expect(i18n.resolve('vi-VN, en;q=0.8')).toBe('vi');
    expect(i18n.resolve('fr-FR')).toBe(DEFAULT_LOCALE);
    expect(i18n.translate('errors.internal_error.detail', 'vi')).toBe(
      'Yêu cầu không thể được hoàn tất.',
    );
  });

  it('returns the key for an unknown translation', () => {
    expect(new I18nService().translate('missing.key', 'en')).toBe('missing.key');
  });

  it('has an error detail translation for every public error code in every locale', () => {
    const i18n = new I18nService();

    for (const locale of ['en', 'vi'] as const) {
      for (const code of Object.values(ERROR_CODES)) {
        const key = `errors.${code}.detail`;

        expect(i18n.translate(key, locale), `${locale} is missing ${key}`).not.toBe(key);
      }
    }
  });

  it('localizes validation field errors without changing their machine-readable code', () => {
    const error = {
      path: 'email',
      code: 'invalid_email',
      rule: 'isEmail',
      message: 'email must be an email',
    } as const;

    expect(new I18nService().translateFieldError(error, 'vi')).toEqual({
      ...error,
      message: 'Hãy nhập địa chỉ email hợp lệ.',
    });
  });
});
