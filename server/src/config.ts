import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Copy server/.env.example to server/.env and fill it in.`,
    )
  }
  return v
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback
}

export const config = {
  get d365Url(): string {
    return required('D365_URL').replace(/\/+$/, '')
  },
  get tenantId(): string {
    return required('AZURE_TENANT_ID')
  },
  get clientId(): string {
    return required('AZURE_CLIENT_ID')
  },
  get clientSecret(): string {
    return required('AZURE_CLIENT_SECRET')
  },
  company: optional('D365_COMPANY', 'USMF'),
  servicePath: optional(
    'D365_SERVICE_PATH',
    'RSMProductCostServiceGroup/RSMProductCostInquiryService/getProductCost',
  ),
  serviceParam: optional('D365_SERVICE_PARAM', '_request'),
  port: Number(optional('PORT', '8787')),
  allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}

/** True when enough is configured to actually reach D365. */
export function isConfigured(): boolean {
  return Boolean(
    process.env.D365_URL &&
      process.env.AZURE_TENANT_ID &&
      process.env.AZURE_CLIENT_ID &&
      process.env.AZURE_CLIENT_SECRET,
  )
}
