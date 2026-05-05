export const MARKETPLACE_IMAGE_SPECS: Record<string, { width: number; height: number; format: 'jpeg' | 'png' | 'webp'; quality: number; maxSizeKb: number }> = {
  mercadolibre: { width: 1200, height: 1200, format: 'jpeg', quality: 90, maxSizeKb: 1024 },
  paris:        { width: 800,  height: 800,  format: 'jpeg', quality: 85, maxSizeKb: 500 },
  falabella:    { width: 1000, height: 1000, format: 'jpeg', quality: 88, maxSizeKb: 800 },
  lider:        { width: 800,  height: 800,  format: 'jpeg', quality: 85, maxSizeKb: 500 },
  shopify:      { width: 2048, height: 2048, format: 'jpeg', quality: 90, maxSizeKb: 2048 },
  woocommerce:  { width: 1200, height: 1200, format: 'jpeg', quality: 88, maxSizeKb: 1024 },
  jumpseller:   { width: 1200, height: 1200, format: 'jpeg', quality: 88, maxSizeKb: 1024 },
  master:       { width: 1600, height: 1600, format: 'jpeg', quality: 92, maxSizeKb: 2048 },
}
