/**
 * portal-classification.service.ts
 *
 * Read-only access to the BIMS resident_classifications table for the
 * resident portal. Uses raw SQL against the shared PostgreSQL database
 * (same pattern as portal-household.service.ts).
 *
 * Mounted at: GET /api/portal/classifications/my
 */

import prisma from '../config/database';

export interface ResidentClassification {
  id: number;
  classification_type: string;
  classification_details: any[];
  type_name: string | null;
  type_color: string | null;
  type_description: string | null;
}

/**
 * Fetch all BIMS classifications assigned to a resident.
 * Joins resident_classifications → classification_types for display metadata.
 * Returns an empty array (not an error) if the resident has no classifications.
 */
export const getMyClassifications = async (
  residentId: string
): Promise<ResidentClassification[]> => {
  const rows = await prisma.$queryRaw<ResidentClassification[]>`
    SELECT
      rc.id,
      rc.classification_type,
      COALESCE(rc.classification_details, '[]'::jsonb) AS classification_details,
      ct.name        AS type_name,
      ct.color       AS type_color,
      ct.description AS type_description
    FROM resident_classifications rc
    LEFT JOIN classification_types ct
      ON ct.name = rc.classification_type
      AND ct.is_active = true
    WHERE rc.resident_id = ${residentId}
    ORDER BY rc.classification_type ASC
  `;

  return rows;
};
