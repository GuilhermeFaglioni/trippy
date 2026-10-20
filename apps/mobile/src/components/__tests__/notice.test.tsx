import { render } from '@testing-library/react-native'

import { DesignSystemProvider } from '../../design-system'
import { Notice } from '../notice'
import { colorToken, numericToken } from './test-tokens'

describe('Notice', () => {
  it('renderiza aviso informativo estático, com texto escalável e tokens', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <Notice message="API indisponível; última atualização às 10:30" testID="api-notice" />
      </DesignSystemProvider>,
    )

    expect(utils.getByTestId('api-notice')).toHaveStyle({
      backgroundColor: colorToken('sand'),
      borderRadius: numericToken('radius-sm'),
      padding: numericToken('space-4'),
    })
    expect(utils.getByText('API indisponível; última atualização às 10:30')).toHaveProp(
      'maxFontSizeMultiplier',
      2,
    )
    expect(utils.queryByRole('button')).toBeNull()
  })

  it('mapeia sucesso e alerta para pares oficiais de tint e ink', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <Notice tone="success" message="API disponível" testID="status-notice" />
      </DesignSystemProvider>,
    )
    expect(utils.getByTestId('status-notice')).toHaveStyle({
      backgroundColor: colorToken('forest-tint'),
    })
    expect(utils.getByText('API disponível')).toHaveStyle({ color: colorToken('forest-ink') })

    await utils.rerender(
      <DesignSystemProvider>
        <Notice tone="warning" message="Sem conexão" testID="status-notice" />
      </DesignSystemProvider>,
    )
    expect(utils.getByTestId('status-notice')).toHaveStyle({
      backgroundColor: colorToken('terracotta-tint'),
    })
    expect(utils.getByText('Sem conexão')).toHaveStyle({
      color: colorToken('terracotta-ink'),
    })
  })

  it('anuncia erro sem expor controle interativo', async () => {
    const utils = await render(
      <DesignSystemProvider>
        <Notice tone="danger" title="Falha na API" message="Tente novamente mais tarde" />
      </DesignSystemProvider>,
    )

    const notice = utils.getByRole('alert')
    expect(notice).toHaveStyle({ backgroundColor: colorToken('surface') })
    expect(utils.getByText('Falha na API')).toHaveStyle({ color: colorToken('danger') })
    expect(utils.getByText('Tente novamente mais tarde')).toBeOnTheScreen()
    expect(utils.queryByRole('button')).toBeNull()
  })
})
