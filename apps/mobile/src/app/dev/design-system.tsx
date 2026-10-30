import { Redirect } from 'expo-router'

import { DesignSystemGallery } from '../../design-system/gallery'

/** Galeria só de desenvolvimento: `/dev/design-system`. Fora de __DEV__ volta para a home. */
export default function DesignSystemGalleryRoute() {
  if (!__DEV__) {
    return <Redirect href="/" />
  }

  return <DesignSystemGallery />
}
