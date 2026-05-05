import { IMarketplaceDriver } from '../types'
import { MercadoLibreDriver } from './mercadolibre.driver'
import { ShopifyDriver } from './shopify.driver'
import { WooCommerceDriver } from './woocommerce.driver'
import { FalabellaDriver } from './falabella.driver'
import { JumpsellerDriver } from './jumpseller.driver'
import { ParisDriver } from './paris.driver'
import { LiderDriver } from './lider.driver'

const drivers = new Map<string, IMarketplaceDriver>()
drivers.set('mercadolibre', new MercadoLibreDriver())
drivers.set('shopify', new ShopifyDriver())
drivers.set('woocommerce', new WooCommerceDriver())
drivers.set('falabella', new FalabellaDriver())
drivers.set('jumpseller', new JumpsellerDriver())
drivers.set('paris', new ParisDriver())
drivers.set('lider', new LiderDriver())

export function getDriver(provider: string): IMarketplaceDriver {
  const driver = drivers.get(provider.toLowerCase())
  if (!driver) throw new Error(`No driver found for provider: ${provider}`)
  return driver
}

export function getSupportedProviders(): string[] {
  return Array.from(drivers.keys())
}

export { MercadoLibreDriver, ShopifyDriver, WooCommerceDriver, FalabellaDriver, JumpsellerDriver, ParisDriver, LiderDriver }
