/* eslint-disable @typescript-eslint/no-require-imports -- Metro exige require estático para assets. */
import { getFontFamilyTokenName } from './typography'

export const customFontAssets = {
  [getFontFamilyTokenName(
    'display',
  )]: require('../../assets/fonts/BricolageGrotesque-Variable.ttf'),
  [getFontFamilyTokenName('sans')]: require('../../assets/fonts/DMSans-Variable.ttf'),
}
