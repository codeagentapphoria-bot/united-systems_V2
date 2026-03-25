/**
 * setupRoutes.js
 *
 * Municipality setup + bulk resident ID download endpoints.
 *
 * Endpoints:
 *   POST /api/setup/municipality    — Select municipality from GeoJSON, auto-create barangays
 *   GET  /api/setup/status          — Check if municipality is configured
 *   GET  /api/residents/bulk-id     — Bulk download resident ID cards as PDF
 */

import express from "express";
import { pool } from "../config/db.js";
import { municipalityAdminOnly, allUsers } from "../middlewares/auth.js";
import logger from "../utils/logger.js";
import PDFDocument from "pdfkit";

const router = express.Router();

// =============================================================================
// GET /api/setup/status
// Returns whether a municipality has been configured for this BIMS instance.
// =============================================================================
router.get("/status", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, municipality_name, gis_code, setup_status FROM municipalities LIMIT 1"
    );

    if (result.rows.length === 0) {
      return res.json({
        configured: false,
        message: "No municipality configured yet",
      });
    }

    const muni = result.rows[0];
    return res.json({
      configured: muni.setup_status === "active",
      municipality: muni,
    });
  } catch (error) {
    logger.error("Setup status error:", error);
    res.status(500).json({ message: "Error checking setup status" });
  }
});

// =============================================================================
// POST /api/setup/municipality
//
// Body: { gis_municipality_code: "PH0802601" }
//
// Flow:
//   1. Look up the GIS municipality from gis_municipality table
//   2. Create a municipalities record (or update existing)
//   3. Query gis_barangay for all barangays in that municipality
//   4. Bulk-create barangays records from GIS data
//
// This replaces the manual municipality + barangay creation flow.
// =============================================================================
router.post("/municipality", ...municipalityAdminOnly, async (req, res) => {
  const { gis_municipality_code } = req.body;

  if (!gis_municipality_code) {
    return res.status(400).json({
      message: "gis_municipality_code is required",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Find the GIS municipality record
    const gisResult = await client.query(
      `SELECT id, name, gis_municipality_code FROM gis_municipality
       WHERE gis_municipality_code = $1`,
      [gis_municipality_code]
    );

    if (gisResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: `Municipality with GIS code ${gis_municipality_code} not found in GIS data`,
      });
    }

    const gisMuni = gisResult.rows[0];

    // Province and region are provided by the admin in the setup form.
    // They are not stored in the GIS tables — the admin must enter them.
    const province = (req.body.province || '').trim();
    const region   = (req.body.region   || '').trim();

    // 2. Update the existing municipality record (there is always exactly one per BIMS instance).
    // We do NOT insert a new row — the seed placeholder is updated in-place so that
    // bims_users.target_id = '1' remains valid and setup_status transitions to 'active'.
    const muniResult = await client.query(
      `UPDATE municipalities SET
        municipality_name  = $1,
        municipality_code  = $2,
        gis_code           = $3,
        region             = $4,
        province           = $5,
        setup_status       = 'active',
        updated_at         = CURRENT_TIMESTAMP
      WHERE id = (SELECT id FROM municipalities ORDER BY id LIMIT 1)
      RETURNING *`,
      [gisMuni.name, gis_municipality_code, gis_municipality_code, region, province]
    );

    const municipality = muniResult.rows[0];

    // 3. Get all barangays for this municipality from GIS data
    const barangaysResult = await client.query(
      `SELECT id, name, gis_barangay_code, gis_municipality_code
       FROM gis_barangay
       WHERE gis_municipality_code = $1
       ORDER BY name ASC`,
      [gis_municipality_code]
    );

    if (barangaysResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: `No barangays found in GIS data for municipality ${gisMuni.name}`,
      });
    }

    // 4. Bulk-insert barangays
    let createdCount = 0;
    let skippedCount = 0;

    for (const gisBarangay of barangaysResult.rows) {
      const result = await client.query(
        `INSERT INTO barangays (municipality_id, barangay_name, barangay_code, gis_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (municipality_id, barangay_name) DO NOTHING
         RETURNING id`,
        [
          municipality.id,
          gisBarangay.name,
          gisBarangay.gis_barangay_code,
          gisBarangay.gis_barangay_code,
        ]
      );

      if (result.rows.length > 0) {
        createdCount++;
      } else {
        skippedCount++;
      }
    }

    await client.query("COMMIT");

    logger.info(`Municipality setup: ${gisMuni.name} — created ${createdCount} barangays`);

    res.status(201).json({
      message: "Municipality configured successfully",
      municipality: {
        id: municipality.id,
        name: municipality.municipality_name,
        gisCode: municipality.gis_code,
      },
      barangays: {
        total: barangaysResult.rows.length,
        created: createdCount,
        skipped: skippedCount,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    logger.error("Municipality setup error:", error);
    res.status(500).json({ message: "Error setting up municipality", error: error.message });
  } finally {
    client.release();
  }
});

// =============================================================================
// GET /api/residents/bulk-id
//
// Query params:
//   barangayId   — filter by barangay (optional; municipality admin gets all)
//   status       — default 'active'
//   format       — 'pdf' (default) | 'json'
//
// Returns a PDF document with ID card layouts for each resident,
// suitable for printing in bulk.
// =============================================================================
router.get("/residents/bulk-id", ...allUsers, async (req, res) => {
  try {
    const { barangayId, status = "active", format = "pdf" } = req.query;
    const user = req.user;

    // Build WHERE clause based on user scope
    const whereClauses = ["r.status = $1"];
    const values = [status];
    let paramIndex = 2;

    if (user.target_type === "municipality") {
      whereClauses.push(`b.municipality_id = $${paramIndex++}`);
      values.push(user.target_id);
    } else {
      // Barangay user — scope to their barangay
      whereClauses.push(`r.barangay_id = $${paramIndex++}`);
      values.push(user.target_id);
    }

    if (barangayId) {
      whereClauses.push(`r.barangay_id = $${paramIndex++}`);
      values.push(barangayId);
    }

    const query = `
      SELECT
        r.id,
        r.resident_id,
        r.first_name,
        r.middle_name,
        r.last_name,
        r.extension_name,
        r.sex,
        r.birthdate,
        r.status,
        r.picture_path,
        b.barangay_name,
        m.municipality_name,
        m.id_background_front_path,
        m.id_background_back_path
      FROM residents r
      LEFT JOIN barangays b ON r.barangay_id = b.id
      LEFT JOIN municipalities m ON b.municipality_id = m.id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY b.barangay_name, r.last_name, r.first_name
    `;

    const result = await pool.query(query, values);

    // JSON response for data preview
    if (format === "json") {
      return res.json({
        count: result.rows.length,
        residents: result.rows,
      });
    }

    // PDF response
    const doc = new PDFDocument({
      size: [153.07, 242.65], // CR80 card size in points (54mm × 85.6mm)
      margin: 5,
      autoFirstPage: false,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="resident-ids-${Date.now()}.pdf"`
    );
    doc.pipe(res);

    for (const resident of result.rows) {
      doc.addPage();

      const fullName = [
        resident.first_name,
        resident.middle_name ? resident.middle_name.charAt(0) + "." : "",
        resident.last_name,
        resident.extension_name || "",
      ]
        .filter(Boolean)
        .join(" ");

      // Draw resident ID card (simple layout — customize with background images in production)
      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .text(resident.municipality_name || "LGU", { align: "center" })
        .moveDown(0.3)
        .fontSize(6)
        .font("Helvetica")
        .text(resident.barangay_name || "", { align: "center" })
        .moveDown(0.5)
        .fontSize(8)
        .font("Helvetica-Bold")
        .text(fullName, { align: "center" })
        .moveDown(0.3)
        .fontSize(7)
        .font("Helvetica")
        .text(resident.resident_id || "PENDING", { align: "center" })
        .moveDown(0.3)
        .fontSize(6)
        .text(
          `DOB: ${resident.birthdate ? new Date(resident.birthdate).toLocaleDateString("en-PH") : "N/A"}`,
          { align: "center" }
        )
        .text(`Sex: ${resident.sex || "N/A"}`, { align: "center" });
    }

    doc.end();
  } catch (error) {
    logger.error("Bulk ID download error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Error generating bulk IDs" });
    }
  }
});

export default router;
