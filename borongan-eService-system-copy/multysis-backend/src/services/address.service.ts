/**
 * address.service.ts
 *
 * Provides address hierarchy data from the barangays + municipalities tables
 * that were auto-created during BIMS municipality setup via GeoJSON.
 *
 * Replaces the old "addresses" reference lookup table (removed in schema v2).
 * The portal registration uses barangayId (integer FK) + street_address (free text).
 */

import prisma from '../config/database';

// =============================================================================
// GET ALL MUNICIPALITIES  (for portal dropdowns)
// =============================================================================

export const getMunicipalities = async () => {
  return prisma.municipality.findMany({
    where: { setupStatus: 'active' },
    select: {
      id: true,
      municipalityName: true,
      municipalityCode: true,
      province: true,
      region: true,
    },
    orderBy: { municipalityName: 'asc' },
  });
};

// =============================================================================
// GET BARANGAYS BY MUNICIPALITY  (for portal address cascading dropdown)
// =============================================================================

export const getBarangaysByMunicipality = async (municipalityId: number) => {
  return prisma.barangay.findMany({
    where: { municipalityId },
    select: {
      id: true,
      barangayName: true,
      barangayCode: true,
      municipality: {
        select: {
          id: true,
          municipalityName: true,
          province: true,
          region: true,
        },
      },
    },
    orderBy: { barangayName: 'asc' },
  });
};

// =============================================================================
// GET SINGLE BARANGAY  (resolves full address context)
// =============================================================================

export const getBarangay = async (barangayId: number) => {
  const barangay = await prisma.barangay.findUnique({
    where: { id: barangayId },
    include: {
      municipality: {
        select: {
          id: true,
          municipalityName: true,
          province: true,
          region: true,
        },
      },
    },
  });

  if (!barangay) throw new Error('Barangay not found');
  return barangay;
};

// =============================================================================
// RESOLVE FULL ADDRESS STRING  (used when displaying a resident's address)
// Format: {street}, {barangay}, {municipality}, {province}, {region}
// =============================================================================

export const resolveFullAddress = async (
  barangayId: number | null | undefined,
  streetAddress: string | null | undefined
): Promise<string> => {
  if (!barangayId) return streetAddress || '';

  const barangay = await prisma.barangay.findUnique({
    where: { id: barangayId },
    include: {
      municipality: { select: { municipalityName: true, province: true, region: true } },
    },
  });

  if (!barangay) return streetAddress || '';

  const parts = [
    streetAddress,
    barangay.barangayName,
    barangay.municipality?.municipalityName,
    barangay.municipality?.province,
    barangay.municipality?.region,
  ].filter(Boolean);

  return parts.join(', ');
};
