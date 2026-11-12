import { useI18n } from '../../lib/i18n';
/** Always visible; one click switches the whole product without resetting model state. */
export default function LanguageSwitch() {
 const { locale, setLocale } = useI18n();
 return <div className="language-switch" role="group" aria-label={locale === 'zh-CN' ? '界面语言' : 'Interface language'}>
  <button type="button" lang="zh-CN" aria-pressed={locale==='zh-CN'}
    onClick={()=>setLocale('zh-CN')}>中文</button>
  <button type="button" lang="en" aria-pressed={locale==='en-US'}
    onClick={()=>setLocale('en-US')}>English</button>
 </div>;
}
