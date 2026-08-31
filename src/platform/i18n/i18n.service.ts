import { Injectable } from '@nestjs/common';

import type { FieldError } from '#shared/errors';

export const SUPPORTED_LOCALES = ['en', 'vi'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const messages: Record<Locale, Record<string, string>> = {
  en: {
    'errors.malformed_request.detail': 'The request could not be parsed.',
    'errors.validation_failed.detail': 'One or more fields are invalid.',
    'errors.not_found.detail': 'The requested resource was not found.',
    'errors.conflict.detail': 'The request conflicts with the current state.',
    'errors.internal_error.detail': 'The request could not be completed.',
    'errors.unauthenticated.detail': 'No valid session.',
    'errors.forbidden.detail': 'The caller is not allowed to perform this operation.',
    'errors.rate_limited.detail': 'Too many requests. Retry later.',
    'errors.request_timeout.detail': 'The request took too long to complete.',
    'errors.payload_too_large.detail': 'The request payload exceeds the allowed size.',
    'errors.unsupported_media_type.detail': 'The request media type is not supported.',
    'errors.service_unavailable.detail': 'The service is temporarily unavailable.',
    'errors.cursor_malformed.detail': 'The pagination cursor is invalid.',
    'errors.user_not_found.detail': 'The user does not exist.',
    'errors.user_profile_not_found.detail': 'The user profile does not exist yet.',
    'errors.display_name_invalid.detail': 'The display name is invalid.',
    'errors.user_role_invalid.detail': 'The user role is invalid.',
    'errors.organization_invalid.detail': 'The organization name or slug is invalid.',
    'errors.organization_access_denied.detail': 'The caller cannot access this organization.',
    'errors.organization_not_found.detail': 'The organization does not exist or is unavailable.',
    'errors.invitation_invalid.detail': 'The invitation could not be issued as requested.',
    'errors.invitation_not_found.detail':
      'That invitation is unknown, already used, or has expired.',
    'errors.member_not_found.detail': 'That person is not a member of this organization.',
    'errors.last_owner.detail': 'An organization must keep at least one owner.',
    'errors.upload_not_found.detail': 'No upload with that id belongs to the caller.',
    'errors.upload_already_confirmed.detail': 'This upload was already confirmed.',
    'errors.upload_size_exceeded.detail': 'The file size is outside the allowed range.',
    'errors.upload_mime_not_allowed.detail': 'The file type is not allowed.',
    'errors.upload_object_missing.detail': 'No uploaded object was found for this file.',
    'errors.upload_content_mismatch.detail': 'The uploaded bytes do not match the declaration.',
    'errors.upload_filename_invalid.detail': 'The filename is invalid.',
    'errors.audit_entry_invalid.detail': 'The audit event contract is invalid.',
    'validation.required': 'This field is required.',
    'validation.wrong_type': 'This field has an invalid type.',
    'validation.too_short': 'This value is too short.',
    'validation.too_long': 'This value is too long.',
    'validation.out_of_range': 'This value is out of range.',
    'validation.invalid_email': 'Enter a valid email address.',
    'validation.invalid_uuid': 'Enter a valid identifier.',
    'validation.invalid_url': 'Enter a valid URL.',
    'validation.invalid_date': 'Enter a valid date.',
    'validation.invalid_enum_value': 'Choose one of the allowed values.',
    'validation.invalid_format': 'This value has an invalid format.',
    'validation.invalid_length': 'This value has an invalid length.',
    'validation.unknown_field': 'This field is not allowed.',
  },
  vi: {
    'errors.malformed_request.detail': 'Không thể phân tích yêu cầu.',
    'errors.validation_failed.detail': 'Một hoặc nhiều trường không hợp lệ.',
    'errors.not_found.detail': 'Không tìm thấy tài nguyên được yêu cầu.',
    'errors.conflict.detail': 'Yêu cầu xung đột với trạng thái hiện tại.',
    'errors.internal_error.detail': 'Yêu cầu không thể được hoàn tất.',
    'errors.unauthenticated.detail': 'Phiên đăng nhập không hợp lệ.',
    'errors.forbidden.detail': 'Bạn không có quyền thực hiện thao tác này.',
    'errors.rate_limited.detail': 'Có quá nhiều yêu cầu. Vui lòng thử lại sau.',
    'errors.request_timeout.detail': 'Yêu cầu mất quá nhiều thời gian để hoàn tất.',
    'errors.payload_too_large.detail': 'Dữ liệu yêu cầu vượt quá kích thước cho phép.',
    'errors.unsupported_media_type.detail': 'Loại nội dung của yêu cầu không được hỗ trợ.',
    'errors.service_unavailable.detail': 'Dịch vụ tạm thời không khả dụng.',
    'errors.cursor_malformed.detail': 'Con trỏ phân trang không hợp lệ.',
    'errors.user_not_found.detail': 'Người dùng không tồn tại.',
    'errors.user_profile_not_found.detail': 'Hồ sơ người dùng chưa tồn tại.',
    'errors.display_name_invalid.detail': 'Tên hiển thị không hợp lệ.',
    'errors.user_role_invalid.detail': 'Vai trò người dùng không hợp lệ.',
    'errors.organization_invalid.detail': 'Tên hoặc slug của tổ chức không hợp lệ.',
    'errors.organization_access_denied.detail': 'Bạn không có quyền truy cập tổ chức này.',
    'errors.organization_not_found.detail': 'Tổ chức không tồn tại hoặc không còn khả dụng.',
    'errors.invitation_invalid.detail': 'Không thể tạo lời mời với thông tin đã nhập.',
    'errors.invitation_not_found.detail': 'Lời mời không tồn tại, đã được sử dụng hoặc đã hết hạn.',
    'errors.member_not_found.detail': 'Người này không phải thành viên của tổ chức.',
    'errors.last_owner.detail': 'Tổ chức phải luôn có ít nhất một chủ sở hữu.',
    'errors.upload_not_found.detail': 'Không tìm thấy tệp thuộc về bạn.',
    'errors.upload_already_confirmed.detail': 'Tệp tải lên này đã được xác nhận.',
    'errors.upload_size_exceeded.detail': 'Kích thước tệp nằm ngoài phạm vi cho phép.',
    'errors.upload_mime_not_allowed.detail': 'Loại tệp này không được phép.',
    'errors.upload_object_missing.detail': 'Không tìm thấy dữ liệu đã tải lên cho tệp này.',
    'errors.upload_content_mismatch.detail': 'Dữ liệu tải lên không khớp với thông tin khai báo.',
    'errors.upload_filename_invalid.detail': 'Tên tệp không hợp lệ.',
    'errors.audit_entry_invalid.detail': 'Hợp đồng sự kiện nhật ký không hợp lệ.',
    'validation.required': 'Trường này là bắt buộc.',
    'validation.wrong_type': 'Trường này có kiểu dữ liệu không hợp lệ.',
    'validation.too_short': 'Giá trị này quá ngắn.',
    'validation.too_long': 'Giá trị này quá dài.',
    'validation.out_of_range': 'Giá trị này nằm ngoài phạm vi cho phép.',
    'validation.invalid_email': 'Hãy nhập địa chỉ email hợp lệ.',
    'validation.invalid_uuid': 'Hãy nhập mã định danh hợp lệ.',
    'validation.invalid_url': 'Hãy nhập URL hợp lệ.',
    'validation.invalid_date': 'Hãy nhập ngày hợp lệ.',
    'validation.invalid_enum_value': 'Hãy chọn một giá trị được phép.',
    'validation.invalid_format': 'Giá trị này có định dạng không hợp lệ.',
    'validation.invalid_length': 'Giá trị này có độ dài không hợp lệ.',
    'validation.unknown_field': 'Trường này không được phép.',
  },
} as const satisfies Record<Locale, Record<string, string>>;

@Injectable()
export class I18nService {
  resolve(value: string | undefined): Locale {
    const candidate = value?.split(',')[0]?.trim().toLowerCase().split('-')[0];

    return isLocale(candidate) ? candidate : DEFAULT_LOCALE;
  }

  translate(key: string, locale: Locale = DEFAULT_LOCALE): string {
    return messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  }

  translateFieldError(error: FieldError, locale: Locale = DEFAULT_LOCALE): FieldError {
    const translated = this.translate(`validation.${error.code}`, locale);

    return translated === `validation.${error.code}` ? error : { ...error, message: translated };
  }
}

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && SUPPORTED_LOCALES.includes(value as Locale);
}
