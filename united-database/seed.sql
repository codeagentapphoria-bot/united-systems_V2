-- =============================================================================
-- SEED DATA — Borongan Unified Database
-- =============================================================================
-- Reference / lookup data that should be present before either backend starts.
-- This does NOT include real resident, citizen, or transactional data —
-- only configuration records that both systems expect to exist.
--
-- HOW TO RUN:
--   Run after schema.sql has been applied and BEFORE running backend servers.
--   psql "$UNIFIED_DB_URL" -f seed.sql
--
-- IDEMPOTENT: Uses INSERT ... ON CONFLICT DO NOTHING throughout.
-- =============================================================================

SET search_path TO public;


-- =============================================================================
-- E-Services: RBAC — Default Roles & Permissions
-- =============================================================================

INSERT INTO public.roles (id, name, description, created_at, updated_at) VALUES
    ('role-super-admin', 'super_admin',    'Full system access',                    now(), now()),
    ('role-admin',       'admin',          'Standard admin access',                 now(), now()),
    ('role-encoder',     'encoder',        'Data entry and transaction processing',  now(), now()),
    ('role-viewer',      'viewer',         'Read-only access',                      now(), now())
ON CONFLICT (id) DO NOTHING;


-- Core resource permissions
INSERT INTO public.permissions (id, resource, action, created_at, updated_at) VALUES
    ('perm-residents-all',      'residents',       'ALL',  now(), now()),
    ('perm-residents-read',     'residents',       'READ', now(), now()),
    ('perm-transactions-all',   'transactions',    'ALL',  now(), now()),
    ('perm-transactions-read',  'transactions',    'READ', now(), now()),
    ('perm-citizens-all',       'citizens',        'ALL',  now(), now()),
    ('perm-citizens-read',      'citizens',        'READ', now(), now()),
    ('perm-services-all',       'services',        'ALL',  now(), now()),
    ('perm-services-read',      'services',        'READ', now(), now()),
    ('perm-tax-all',            'tax_profiles',    'ALL',  now(), now()),
    ('perm-tax-read',           'tax_profiles',    'READ', now(), now()),
    ('perm-reports-read',       'reports',         'READ', now(), now()),
    ('perm-users-all',          'users',           'ALL',  now(), now()),
    ('perm-users-read',         'users',           'READ', now(), now()),
    ('perm-beneficiaries-all',  'beneficiaries',   'ALL',  now(), now()),
    ('perm-beneficiaries-read', 'beneficiaries',   'READ', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Role ↔ Permission mappings
INSERT INTO public.role_permissions (id, role_id, permission_id, created_at) VALUES
    -- super_admin: ALL on everything
    ('rp-sa-res-all',   'role-super-admin', 'perm-residents-all',     now()),
    ('rp-sa-txn-all',   'role-super-admin', 'perm-transactions-all',  now()),
    ('rp-sa-cit-all',   'role-super-admin', 'perm-citizens-all',      now()),
    ('rp-sa-svc-all',   'role-super-admin', 'perm-services-all',      now()),
    ('rp-sa-tax-all',   'role-super-admin', 'perm-tax-all',           now()),
    ('rp-sa-rep-read',  'role-super-admin', 'perm-reports-read',      now()),
    ('rp-sa-usr-all',   'role-super-admin', 'perm-users-all',         now()),
    ('rp-sa-ben-all',   'role-super-admin', 'perm-beneficiaries-all', now()),
    -- admin: ALL on transactions, citizens, services; READ on users
    ('rp-ad-txn-all',   'role-admin', 'perm-transactions-all',  now()),
    ('rp-ad-cit-all',   'role-admin', 'perm-citizens-all',      now()),
    ('rp-ad-svc-all',   'role-admin', 'perm-services-all',      now()),
    ('rp-ad-tax-all',   'role-admin', 'perm-tax-all',           now()),
    ('rp-ad-rep-read',  'role-admin', 'perm-reports-read',      now()),
    ('rp-ad-usr-read',  'role-admin', 'perm-users-read',        now()),
    ('rp-ad-ben-all',   'role-admin', 'perm-beneficiaries-all', now()),
    -- encoder: ALL on transactions and citizens
    ('rp-en-txn-all',   'role-encoder', 'perm-transactions-all', now()),
    ('rp-en-cit-all',   'role-encoder', 'perm-citizens-all',     now()),
    ('rp-en-ben-all',   'role-encoder', 'perm-beneficiaries-all',now()),
    -- viewer: READ on everything
    ('rp-vw-res-read',  'role-viewer', 'perm-residents-read',     now()),
    ('rp-vw-txn-read',  'role-viewer', 'perm-transactions-read',  now()),
    ('rp-vw-cit-read',  'role-viewer', 'perm-citizens-read',      now()),
    ('rp-vw-svc-read',  'role-viewer', 'perm-services-read',      now()),
    ('rp-vw-tax-read',  'role-viewer', 'perm-tax-read',           now()),
    ('rp-vw-rep-read',  'role-viewer', 'perm-reports-read',       now()),
    ('rp-vw-ben-read',  'role-viewer', 'perm-beneficiaries-read', now())
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- E-Services: Social Amelioration Settings (lookup values)
-- =============================================================================

-- Pension types (senior citizen)
INSERT INTO public.social_amelioration_settings (id, type, name, description, is_active, created_at, updated_at) VALUES
    ('sas-pt-ssp',   'PENSION_TYPE', 'Social Security Pension (SSP)',   'Monthly pension under SSS',             true, now(), now()),
    ('sas-pt-gsis',  'PENSION_TYPE', 'GSIS Pension',                    'Monthly pension under GSIS',            true, now(), now()),
    ('sas-pt-dswd',  'PENSION_TYPE', 'DSWD Social Pension',             'DSWD social pension for indigent seniors', true, now(), now()),
    ('sas-pt-other', 'PENSION_TYPE', 'Other Pension',                   'Other pension source',                  true, now(), now()),
-- Disability types (PWD)
    ('sas-dt-ortho', 'DISABILITY_TYPE', 'Orthopedic / Physical',        'Mobility impairment',                   true, now(), now()),
    ('sas-dt-visual','DISABILITY_TYPE', 'Visual Impairment',            'Partial or total blindness',            true, now(), now()),
    ('sas-dt-hearing','DISABILITY_TYPE','Hearing Impairment',           'Partial or total deafness',             true, now(), now()),
    ('sas-dt-speech','DISABILITY_TYPE', 'Speech Impairment',            'Communication disability',              true, now(), now()),
    ('sas-dt-mental','DISABILITY_TYPE', 'Intellectual / Mental',        'Intellectual or developmental disability', true, now(), now()),
    ('sas-dt-psycho','DISABILITY_TYPE', 'Psychosocial',                 'Mental health-related disability',      true, now(), now()),
    ('sas-dt-chronic','DISABILITY_TYPE','Chronic Illness',              'Disability due to chronic disease',     true, now(), now()),
    ('sas-dt-other', 'DISABILITY_TYPE', 'Other Disability',             'Other type of disability',              true, now(), now()),
-- Grade levels (student)
    ('sas-gl-elem',  'GRADE_LEVEL', 'Elementary (Grade 1–6)',           'Primary education level',               true, now(), now()),
    ('sas-gl-jhs',   'GRADE_LEVEL', 'Junior High School (Grade 7–10)',  'Junior secondary education',            true, now(), now()),
    ('sas-gl-shs',   'GRADE_LEVEL', 'Senior High School (Grade 11–12)', 'Senior secondary education',            true, now(), now()),
    ('sas-gl-college','GRADE_LEVEL','College / Undergraduate',          'Tertiary education',                    true, now(), now()),
    ('sas-gl-voctech','GRADE_LEVEL','Vocational / Technical',           'TESDA or vocational course',            true, now(), now()),
-- Solo parent categories
    ('sas-sp-widowed','SOLO_PARENT_CATEGORY','Widowed Parent',          'Parent due to death of spouse',         true, now(), now()),
    ('sas-sp-separated','SOLO_PARENT_CATEGORY','Separated / Abandoned', 'Parent due to separation or abandonment', true, now(), now()),
    ('sas-sp-ofw',   'SOLO_PARENT_CATEGORY', 'OFW Spouse',             'Spouse working abroad',                 true, now(), now()),
    ('sas-sp-unmarried','SOLO_PARENT_CATEGORY','Unmarried Parent',      'Never-married solo parent',             true, now(), now()),
    ('sas-sp-other', 'SOLO_PARENT_CATEGORY', 'Other',                  'Other circumstance',                    true, now(), now())
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- E-Services: Government Programs
-- =============================================================================

INSERT INTO public.government_programs (id, name, description, type, is_active, created_at, updated_at) VALUES
    ('gp-sc-osca',  '4Ps / OSCA Benefits',        'Pantawid Pamilyang Pilipino Program for senior citizens', 'SENIOR_CITIZEN', true, now(), now()),
    ('gp-sc-philhealth', 'PhilHealth Senior',      'PhilHealth coverage for senior citizens',                 'SENIOR_CITIZEN', true, now(), now()),
    ('gp-pwd-main', 'PWD Benefits Program',        'National PWD financial assistance and benefits',          'PWD',            true, now(), now()),
    ('gp-pwd-assist','Assistive Device Program',   'Government-issued assistive devices for PWD',             'PWD',            true, now(), now()),
    ('gp-st-ched',  'CHED Scholarships',           'Commission on Higher Education scholarship grants',       'STUDENT',        true, now(), now()),
    ('gp-st-deped', 'DepEd Educational Assistance','Department of Education student assistance program',      'STUDENT',        true, now(), now()),
    ('gp-sp-ra8972','RA 8972 Solo Parent Benefits','Benefits under the Solo Parents'' Welfare Act',           'SOLO_PARENT',    true, now(), now()),
    ('gp-all-4ps',  '4Ps (All Beneficiary Types)', 'Pantawid Pamilyang Pilipino Program (general)',           'ALL',            true, now(), now())
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- E-Services: FAQs (placeholder — update content via admin UI)
-- =============================================================================

INSERT INTO public.faqs (id, question, answer, "order", is_active, created_at, updated_at) VALUES
    ('faq-01',
     'How do I register as a citizen on the portal?',
     'Click "Register" on the home page, fill in your personal details, and upload a valid government-issued ID. Your registration will be reviewed within 3–5 business days.',
     1, true, now(), now()),

    ('faq-02',
     'What services are available online?',
     'You can request barangay certificates, business permits, and other documents online. Some services may require an in-person pickup.',
     2, true, now(), now()),

    ('faq-03',
     'How do I track the status of my request?',
     'Log in to your account and go to "My Transactions" to view the real-time status of all your submitted requests.',
     3, true, now(), now()),

    ('faq-04',
     'What payment methods are accepted?',
     'We accept GCash, PayMaya, bank transfer, and over-the-counter cash payments at the municipal hall.',
     4, true, now(), now()),

    ('faq-05',
     'How do I update my contact information?',
     'Log in and go to "My Profile" to update your contact number or email address.',
     5, true, now(), now())
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- E-Services: Sample Address entries (Borongan reference data)
-- Add full address list via CSV import or admin UI — these are starters only.
-- =============================================================================

INSERT INTO public.addresses (id, region, province, municipality, barangay, postal_code, street_address, is_active, created_at, updated_at) VALUES
    ('addr-brgy-1', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 1',   '6800', NULL, true, now(), now()),
    ('addr-brgy-2', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 2',   '6800', NULL, true, now(), now()),
    ('addr-brgy-3', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 3',   '6800', NULL, true, now(), now()),
    ('addr-brgy-4', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 4',   '6800', NULL, true, now(), now()),
    ('addr-brgy-5', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 5',   '6800', NULL, true, now(), now()),
    ('addr-brgy-6', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 6',   '6800', NULL, true, now(), now()),
    ('addr-brgy-7', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 7',   '6800', NULL, true, now(), now()),
    ('addr-brgy-8', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 8',   '6800', NULL, true, now(), now()),
    ('addr-brgy-9', 'Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 9',   '6800', NULL, true, now(), now()),
    ('addr-brgy-10','Region VIII', 'Eastern Samar', 'Borongan', 'Barangay 10',  '6800', NULL, true, now(), now())
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- Completion notice
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE '=== Seed data applied successfully ===';
    RAISE NOTICE '  Roles:                       %', (SELECT COUNT(*) FROM public.roles);
    RAISE NOTICE '  Permissions:                 %', (SELECT COUNT(*) FROM public.permissions);
    RAISE NOTICE '  Role-Permission mappings:    %', (SELECT COUNT(*) FROM public.role_permissions);
    RAISE NOTICE '  Social amelioration settings:%', (SELECT COUNT(*) FROM public.social_amelioration_settings);
    RAISE NOTICE '  Government programs:         %', (SELECT COUNT(*) FROM public.government_programs);
    RAISE NOTICE '  FAQs:                        %', (SELECT COUNT(*) FROM public.faqs);
    RAISE NOTICE '  Addresses (starter set):     %', (SELECT COUNT(*) FROM public.addresses);
END$$;
