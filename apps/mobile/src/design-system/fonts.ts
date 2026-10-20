/* eslint-disable @typescript-eslint/no-require-imports -- Metro exige require estático para assets. */
import { getFontFamilyForPlatform, getFontFamilyTokenName } from './typography'

export const customFontAssets = {
  [getFontFamilyTokenName(
    'display',
  )]: require('../../assets/fonts/BricolageGrotesque-Variable.ttf'),
  [getFontFamilyTokenName('sans')]: require('../../assets/fonts/DMSans-Variable.ttf'),
  [getFontFamilyForPlatform(
    'local',
    'ios',
    'zh-CN',
  )]: require('../../assets/fonts/NotoSansSC-Variable.ttf'),
  [getFontFamilyForPlatform(
    'local',
    'ios',
    'ja-JP',
  )]: require('../../assets/fonts/NotoSansJP-Variable.ttf'),
  [getFontFamilyForPlatform(
    'local',
    'ios',
    'ko-KR',
  )]: require('../../assets/fonts/NotoSansKR-Variable.ttf'),
}
