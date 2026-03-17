/**
 * GET /api/documents/coverage
 * ============================
 * Returns country coverage statistics for document verification.
 * Used by the landing page, on-premise page, and IE University demo.
 *
 * No authentication required — this is public information.
 */

import { NextResponse } from 'next/server'
import {
  COUNTRIES,
  getCoverageStats,
  getCountriesByRegion,
} from '@/lib/countryValidators'

export async function GET(): Promise<NextResponse> {
  const stats = getCoverageStats()

  const regions = Object.entries(stats.regionsBreakdown).map(([region, count]) => ({
    region,
    count,
    countries: getCountriesByRegion(region).map(c => ({
      name:           c.name,
      code3:          c.code3,
      code2:          c.code2,
      idTypes:        c.idTypes,
      mrzFormats:     c.mrzFormats,
      hasNFC:         c.hasNFC,
    })),
  }))

  return NextResponse.json({
    totalCountries:  stats.totalCountries,
    tier1Countries:  stats.tier1Countries,
    tier2Countries:  stats.tier2Countries,
    tier3Countries:  stats.tier3Countries,
    nfcCountries:    stats.nfcCountries,
    regions,
    // Flat list of all supported country codes (for quick lookup)
    supportedCodes:  COUNTRIES.map(c => c.code3),
    // ICAO 9303 MRZ format support
    mrzSupport: {
      TD1:    COUNTRIES.filter(c => c.mrzFormats.includes('TD1')).length,
      TD2:    COUNTRIES.filter(c => c.mrzFormats.includes('TD2')).length,
      TD3:    COUNTRIES.filter(c => c.mrzFormats.includes('TD3')).length,
      'MRV-B': COUNTRIES.filter(c => c.mrzFormats.includes('MRV-B')).length,
    },
  })
}
