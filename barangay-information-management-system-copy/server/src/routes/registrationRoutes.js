/**
 * registrationRoutes.js  (C1 fix — AC3)
 *
 * BIMS-side endpoints for reviewing portal registration requests.
 * These operate directly on the shared PostgreSQL database, eliminating
 * the cross-system HTTP call from BIMS frontend → E-Services backend.
 *
 * All endpoints require BIMS staff authentication (allUsers middleware).
 *
 * Routes:
 *   GET    /api/portal-registration/requests                    list with filters
 *   PATCH  /api/portal-registration/requests/:id/under-review   mark as under review
 *   POST   /api/portal-registration/requests/:id/review         approve or reject
 *   POST   /api/portal-registration/requests/:id/request-docs   request resubmission
 */

import { Router } from 'express';
import { pool } from '../config/db.js';
import { allUsers } from '../middlewares/auth.js';
import logger from '../utils/logger.js';

const router = Router();

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Atomically increment the resident counter for (municipalityId, year) and
 * return the generated resident_id string.
 */
async function generateResidentId(client, municipalityId) {
  const year = new Date().getFullYear();

  // Each municipality has its own counter starting at 1.
  // The generated resident_id embeds the municipality_id to ensure global uniqueness:
  //   RES-{year}-{municipalityId padded 3}{counter padded 4}
  // e.g., municipality 1, counter 1  → RES-2026-0010001
  //        municipality 2, counter 1  → RES-2026-0020001
  const { rows } = await client.query(
    `INSERT INTO resident_counters (municipality_id, year, counter, prefix)
     VALUES ($1, $2, 1, 'RES')
     ON CONFLICT (municipality_id, year)
     DO UPDATE SET
       counter    = resident_counters.counter + 1,
       updated_at = now()
     RETURNING counter, prefix`,
    [municipalityId, year]
  );

  const { counter, prefix } = rows[0];
  const munPart = String(municipalityId).padStart(3, '0');
  const cntPart = String(counter).padStart(4, '0');
  return `${prefix}-${year}-${munPart}${cntPart}`;
}

// =============================================================================
// GET /api/portal-registration/requests
//
// Query params:
//   status     — filter by status string (blank = all)
//   search     — partial match on first_name, last_name, username
//   barangayId — filter by barangay (set automatically for barangay staff)
//   page       — 1-indexed page number (default 1)
//   limit      — rows per page (default 20)
// =============================================================================
router.get('/requests', ...allUsers, async (req, res) => {
  try {
    const {
      status,
      search,
      page    = 1,
      limit   = 20,
    } = req.query;

    // Barangay staff see only their barangay; municipality staff see all.
    const barangayId =
      req.query.barangayId
        ? parseInt(req.query.barangayId)
        : req.user?.target_type === 'barangay'
          ? parseInt(req.user.target_id)
          : null;

    const offset = (Math.max(parseInt(page), 1) - 1) * parseInt(limit);
    const params = [];
    let   pidx   = 1;

    const conditions = [];

    if (barangayId) {
      conditions.push(`r.barangay_id = $${pidx++}`);
      params.push(barangayId);
    }
    if (status) {
      conditions.push(`rr.status = $${pidx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(
        `(r.first_name ILIKE $${pidx} OR r.last_name ILIKE $${pidx} OR r.username ILIKE $${pidx})`
      );
      params.push(`%${search}%`);
      pidx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseQuery = `
      FROM registration_requests rr
      JOIN residents r ON r.id = rr.resident_fk
      LEFT JOIN barangays b ON b.id = r.barangay_id
      ${where}
    `;

    const [countResult, dataResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) ${baseQuery}`, params),
      pool.query(
        `SELECT
           rr.id,
           rr.status,
           rr.admin_notes,
           rr.reviewed_by,
           rr.reviewed_at,
           rr.selfie_url,
           rr.created_at,
           rr.updated_at,
           json_build_object(
             'id',                      r.id,
             'first_name',              r.first_name,
             'last_name',               r.last_name,
             'middle_name',             r.middle_name,
             'extension_name',          r.extension_name,
             'username',                r.username,
             'email',                   r.email,
             'contact_number',          r.contact_number,
             'sex',                     r.sex,
             'civil_status',            r.civil_status,
             'birthdate',               r.birthdate,
             'street_address',          r.street_address,
             'picture_path',            r.picture_path,
             'proof_of_identification', r.proof_of_identification,
             'barangay', CASE WHEN b.id IS NOT NULL THEN
               json_build_object(
                 'id',            b.id,
                 'barangay_name', b.barangay_name
               )
             ELSE NULL END
           ) AS resident
         ${baseQuery}
         ORDER BY rr.created_at DESC
         LIMIT $${pidx} OFFSET $${pidx + 1}`,
        [...params, parseInt(limit), offset]
      ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      status: 'success',
      data: {
        requests: dataResult.rows,
        pagination: {
          page:       Math.max(parseInt(page), 1),
          limit:      parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    logger.error('registrationRoutes.getRequests:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


// =============================================================================
// PATCH /api/portal-registration/requests/:id/under-review
// =============================================================================
router.patch('/requests/:id/under-review', ...allUsers, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE registration_requests
          SET status     = 'under_review',
              updated_at = now()
        WHERE id = $1
        RETURNING id, status`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Registration request not found' });
    }
    res.json({ status: 'success', data: rows[0] });
  } catch (err) {
    logger.error('registrationRoutes.underReview:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


// =============================================================================
// POST /api/portal-registration/requests/:id/review
//
// Body: { action: 'approve' | 'reject', adminNotes?: string }
//
// On approve:
//   1. Verify request is pending or under_review
//   2. Resolve municipality from resident's barangay
//   3. Atomically generate resident_id
//   4. Update residents.status = 'active', set resident_id
//   5. Update registration_requests (status, reviewed_by, reviewed_at, admin_notes)
//
// On reject:
//   1. Update residents.status = 'rejected'
//   2. Update registration_requests (status, reviewed_by, reviewed_at, admin_notes)
// =============================================================================
router.post('/requests/:id/review', ...allUsers, async (req, res) => {
  const { action, adminNotes } = req.body;

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ status: 'error', message: "action must be 'approve' or 'reject'" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch the registration request + resident info
    const { rows: reqRows } = await client.query(
      `SELECT rr.id, rr.status, rr.resident_fk,
              r.barangay_id, b.municipality_id
         FROM registration_requests rr
         JOIN residents r ON r.id = rr.resident_fk
         LEFT JOIN barangays b ON b.id = r.barangay_id
         WHERE rr.id = $1
        FOR UPDATE OF rr`,
      [req.params.id]
    );

    if (reqRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', message: 'Registration request not found' });
    }

    const regReq = reqRows[0];

    if (!['pending', 'under_review'].includes(regReq.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        status: 'error',
        message: `Cannot ${action} a request that is already '${regReq.status}'`,
      });
    }

    const reviewedBy = req.user?.id ? parseInt(req.user.id) : null;

    if (action === 'approve') {
      if (!regReq.municipality_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          status: 'error',
          message: 'Resident has no barangay assigned — cannot generate resident ID',
        });
      }

      // 2. Generate resident_id
      const residentId = await generateResidentId(client, regReq.municipality_id);

      // 3. Activate the resident record
      await client.query(
        `UPDATE residents
            SET status               = 'active',
                resident_id          = $1,
                application_remarks  = $2,
                updated_at           = now()
          WHERE id = $3`,
        [residentId, adminNotes || null, regReq.resident_fk]
      );

      // 4. Mark request approved
      await client.query(
        `UPDATE registration_requests
            SET status       = 'approved',
                reviewed_by  = $1,
                reviewed_at  = now(),
                admin_notes  = $2,
                updated_at   = now()
          WHERE id = $3`,
        [reviewedBy, adminNotes || null, regReq.id]
      );

      await client.query('COMMIT');

      res.json({
        status: 'success',
        message: `Registration approved. Resident ID: ${residentId}`,
        data: { residentId },
      });

    } else {
      // reject
      await client.query(
        `UPDATE residents
            SET status              = 'rejected',
                application_remarks = $1,
                updated_at          = now()
          WHERE id = $2`,
        [adminNotes || null, regReq.resident_fk]
      );

      await client.query(
        `UPDATE registration_requests
            SET status      = 'rejected',
                reviewed_by = $1,
                reviewed_at = now(),
                admin_notes = $2,
                updated_at  = now()
          WHERE id = $3`,
        [reviewedBy, adminNotes || null, regReq.id]
      );

      await client.query('COMMIT');
      res.json({ status: 'success', message: 'Registration rejected' });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('registrationRoutes.review:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  } finally {
    client.release();
  }
});


// =============================================================================
// POST /api/portal-registration/requests/:id/request-docs
//
// Body: { adminNotes: string }  — message shown to applicant explaining what to resubmit
// =============================================================================
router.post('/requests/:id/request-docs', ...allUsers, async (req, res) => {
  try {
    const { adminNotes } = req.body;

    if (!adminNotes?.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'adminNotes is required — tell the applicant what to resubmit',
      });
    }

    const { rows } = await pool.query(
      `UPDATE registration_requests
          SET status     = 'requires_resubmission',
              admin_notes = $1,
              updated_at  = now()
        WHERE id = $2
        RETURNING id, status`,
      [adminNotes.trim(), req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Registration request not found' });
    }

    res.json({ status: 'success', data: rows[0] });
  } catch (err) {
    logger.error('registrationRoutes.requestDocs:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


export default router;
