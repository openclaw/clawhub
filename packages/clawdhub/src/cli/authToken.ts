import { readGlobalConfig } from '../config.js'
import { fail } from './ui.js'

export async function getOptionalAuthToken(): Promise<string | undefined> {
  const cfg = await readGlobalConfig()
  return cfg?.token ?? undefined
}

export async function requireAuthToken(): Promise<string> {
  const token = await getOptionalAuthToken()
  if (!token) fail('Not logged in. Run: clawhub login')
  return token
}

