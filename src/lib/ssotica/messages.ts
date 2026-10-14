import { getT } from '@/lib/i18n/translate'
import type { SsoticaError } from './client'

const t = getT('Api')

/** User-facing (translated) text for a failed ssOtica call. */
export function ssoticaErrorMessage(err: SsoticaError): string {
  switch (err.code) {
    case 'invalid_key':
      return t('ssotica.invalidKey')
    case 'user_blocked':
      return t('ssotica.userBlocked')
    case 'store_not_found':
      return t('ssotica.storeNotFound')
    case 'api_not_contracted':
      return t('ssotica.apiNotContracted')
    case 'contract_unreadable':
      return t('ssotica.contractUnreadable')
    case 'network':
      return t('ssotica.network')
    default:
      return t('ssotica.unexpected')
  }
}
