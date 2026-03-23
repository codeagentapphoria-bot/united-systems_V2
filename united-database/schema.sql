-- =============================================================================
-- BORONGAN UNIFIED SYSTEM — Unified Database Schema
-- =============================================================================
-- Generated: Mar 23, 2026
-- Source 1:  barangay-information-management-system-copy/main-db.sql
-- Source 2:  borongan-eService-system-copy/multysis-backend/prisma/schema.prisma
--
-- Key renames from originals:
--   BIMS    users  →  bims_users
--   E-Svc   users  →  eservice_users
--
-- New tables:
--   citizen_resident_mapping  (bridge between residents ↔ citizens)
--
-- Run order:
--   1. Extensions
--   2. Functions & triggers
--   3. BIMS tables (geography → people → household → services → audit)
--   4. E-Services tables (auth → people → services → tax → beneficiaries → util)
--   5. Bridge tables
--   6. Indexes
--   7. Triggers (attach)
--   8. Foreign keys
-- =============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;  -- for fuzzy matching

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- BIMS: audit user session helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_audit_user()
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN COALESCE(current_setting('audit.user_id', true)::INTEGER, NULL);
END;
$$;


-- ---------------------------------------------------------------------------
-- BIMS: updated_at auto-stamp
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- BIMS: audit trigger — writes change history to audit_logs on every
--        INSERT / UPDATE / DELETE on major BIMS tables.
--        References bims_users (renamed from users).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    audit_barangay_id INTEGER := NULL;
    audit_record_id   VARCHAR(20);
    audit_old_values  JSONB := NULL;
    audit_new_values  JSONB := NULL;
BEGIN
    IF TG_TABLE_NAME = 'residents' THEN
        IF TG_OP = 'DELETE' THEN
            audit_barangay_id := OLD.barangay_id;  audit_record_id := OLD.id;
        ELSE
            audit_barangay_id := NEW.barangay_id;  audit_record_id := NEW.id;
        END IF;

    ELSIF TG_TABLE_NAME = 'households' THEN
        IF TG_OP = 'DELETE' THEN
            audit_barangay_id := OLD.barangay_id;  audit_record_id := OLD.id::VARCHAR;
        ELSE
            audit_barangay_id := NEW.barangay_id;  audit_record_id := NEW.id::VARCHAR;
        END IF;

    ELSIF TG_TABLE_NAME = 'families' THEN
        IF TG_OP = 'DELETE' THEN
            SELECT h.barangay_id INTO audit_barangay_id FROM households h WHERE h.id = OLD.household_id;
            audit_record_id := OLD.id::VARCHAR;
        ELSE
            SELECT h.barangay_id INTO audit_barangay_id FROM households h WHERE h.id = NEW.household_id;
            audit_record_id := NEW.id::VARCHAR;
        END IF;

    ELSIF TG_TABLE_NAME = 'family_members' THEN
        IF TG_OP = 'DELETE' THEN
            SELECT h.barangay_id INTO audit_barangay_id
            FROM families f JOIN households h ON h.id = f.household_id WHERE f.id = OLD.family_id;
            audit_record_id := OLD.id::VARCHAR;
        ELSE
            SELECT h.barangay_id INTO audit_barangay_id
            FROM families f JOIN households h ON h.id = f.household_id WHERE f.id = NEW.family_id;
            audit_record_id := NEW.id::VARCHAR;
        END IF;

    ELSIF TG_TABLE_NAME = 'archives' THEN
        IF TG_OP = 'DELETE' THEN
            audit_barangay_id := OLD.barangay_id;  audit_record_id := OLD.id::VARCHAR;
        ELSE
            audit_barangay_id := NEW.barangay_id;  audit_record_id := NEW.id::VARCHAR;
        END IF;

    ELSIF TG_TABLE_NAME = 'inventories' THEN
        IF TG_OP = 'DELETE' THEN
            audit_barangay_id := OLD.barangay_id;  audit_record_id := OLD.id::VARCHAR;
        ELSE
            audit_barangay_id := NEW.barangay_id;  audit_record_id := NEW.id::VARCHAR;
        END IF;

    ELSIF TG_TABLE_NAME = 'pets' THEN
        IF TG_OP = 'DELETE' THEN
            SELECT r.barangay_id INTO audit_barangay_id FROM residents r WHERE r.id = OLD.owner_id;
            audit_record_id := OLD.id::VARCHAR;
        ELSE
            SELECT r.barangay_id INTO audit_barangay_id FROM residents r WHERE r.id = NEW.owner_id;
            audit_record_id := NEW.id::VARCHAR;
        END IF;

    ELSIF TG_TABLE_NAME = 'requests' THEN
        IF TG_OP = 'DELETE' THEN
            IF OLD.resident_id IS NOT NULL THEN
                SELECT r.barangay_id INTO audit_barangay_id FROM residents r WHERE r.id = OLD.resident_id;
            END IF;
            audit_record_id := OLD.id::VARCHAR;
        ELSE
            IF NEW.resident_id IS NOT NULL THEN
                SELECT r.barangay_id INTO audit_barangay_id FROM residents r WHERE r.id = NEW.resident_id;
            END IF;
            audit_record_id := NEW.id::VARCHAR;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        audit_old_values := to_jsonb(OLD);
    ELSIF TG_OP = 'INSERT' THEN
        audit_new_values := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        audit_old_values := to_jsonb(OLD);
        audit_new_values := to_jsonb(NEW);
    END IF;

    INSERT INTO public.audit_logs (
        barangay_id, table_name, operation, record_id,
        old_values, new_values, changed_by, changed_at
    ) VALUES (
        audit_barangay_id, TG_TABLE_NAME, TG_OP, audit_record_id,
        audit_old_values, audit_new_values, public.get_current_audit_user(), CURRENT_TIMESTAMP
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- BIMS: audit log query helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_all_audit_logs(p_limit integer DEFAULT 100)
RETURNS TABLE(
    id integer, barangay_id integer, barangay_name character varying,
    table_name character varying, operation character varying,
    record_id character varying, old_values jsonb, new_values jsonb,
    changed_by integer, user_name character varying,
    changed_at timestamp without time zone
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT al.id, al.barangay_id, b.barangay_name, al.table_name, al.operation,
           al.record_id, al.old_values, al.new_values, al.changed_by,
           u.full_name AS user_name, al.changed_at
    FROM public.audit_logs al
    LEFT JOIN public.bims_users u ON u.id = al.changed_by
    LEFT JOIN public.barangays b  ON b.id = al.barangay_id
    ORDER BY al.changed_at DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_barangay_audit_logs(p_barangay_id integer, p_limit integer DEFAULT 100)
RETURNS TABLE(
    id integer, table_name character varying, operation character varying,
    record_id character varying, old_values jsonb, new_values jsonb,
    changed_by integer, user_name character varying,
    changed_at timestamp without time zone
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT al.id, al.table_name, al.operation, al.record_id,
           al.old_values, al.new_values, al.changed_by,
           u.full_name AS user_name, al.changed_at
    FROM public.audit_logs al
    LEFT JOIN public.bims_users u ON u.id = al.changed_by
    WHERE al.barangay_id = p_barangay_id
    ORDER BY al.changed_at DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_record_audit_history(p_table_name character varying, p_record_id character varying)
RETURNS TABLE(
    id integer, operation character varying,
    old_values jsonb, new_values jsonb,
    changed_by integer, user_name character varying,
    changed_at timestamp without time zone
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT al.id, al.operation, al.old_values, al.new_values,
           al.changed_by, u.full_name AS user_name, al.changed_at
    FROM public.audit_logs al
    LEFT JOIN public.bims_users u ON u.id = al.changed_by
    WHERE al.table_name = p_table_name AND al.record_id = p_record_id
    ORDER BY al.changed_at DESC;
END;
$$;


-- =============================================================================
-- ENUMS (E-Services)
-- =============================================================================

CREATE TYPE public.person_type              AS ENUM ('CITIZEN', 'SUBSCRIBER');
CREATE TYPE public.subscriber_status        AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'BLOCKED');
CREATE TYPE public.registration_status      AS ENUM ('PENDING', 'UNDER_REVIEW', 'REQUIRES_RESUBMISSION', 'APPROVED', 'REJECTED');
CREATE TYPE public.citizen_status           AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED');
CREATE TYPE public.residency_type           AS ENUM ('RESIDENT', 'NON_RESIDENT');
CREATE TYPE public.permission_action        AS ENUM ('READ', 'ALL');
CREATE TYPE public.beneficiary_status       AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');
CREATE TYPE public.beneficiary_type         AS ENUM ('SENIOR_CITIZEN', 'PWD', 'STUDENT', 'SOLO_PARENT');
CREATE TYPE public.government_program_type  AS ENUM ('SENIOR_CITIZEN', 'PWD', 'STUDENT', 'SOLO_PARENT', 'ALL');
CREATE TYPE public.social_amelioration_setting_type AS ENUM ('PENSION_TYPE', 'DISABILITY_TYPE', 'GRADE_LEVEL', 'SOLO_PARENT_CATEGORY');
CREATE TYPE public.tax_version_status       AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE public.exemption_type           AS ENUM ('SENIOR_CITIZEN', 'PWD', 'SOLO_PARENT', 'OTHER');
CREATE TYPE public.exemption_status         AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE public.payment_method           AS ENUM ('CASH', 'CHECK', 'ONLINE', 'BANK_TRANSFER', 'GCASH', 'PAYMAYA', 'OTHER');
CREATE TYPE public.appointment_status       AS ENUM ('PENDING', 'ACCEPTED', 'REQUESTED_UPDATE', 'DECLINED', 'CANCELLED');
CREATE TYPE public.appointment_note_type    AS ENUM ('GENERAL', 'DATE_CHANGE_REASON', 'FOLLOW_UP', 'INTERNAL');
CREATE TYPE public.transaction_note_sender_type AS ENUM ('ADMIN', 'SUBSCRIBER');
CREATE TYPE public.update_request_status    AS ENUM ('NONE', 'PENDING_PORTAL', 'PENDING_ADMIN', 'APPROVED', 'REJECTED');
CREATE TYPE public.update_requested_by      AS ENUM ('PORTAL', 'ADMIN');


-- =============================================================================
-- BIMS TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Geographic / Administrative
-- ---------------------------------------------------------------------------

CREATE TABLE public.municipalities (
    id                      integer NOT NULL,
    municipality_name       character varying(50)  NOT NULL,
    municipality_code       character varying(8)   NOT NULL,
    gis_code                character varying(20),
    region                  character varying(20)  NOT NULL,
    province                character varying(50)  NOT NULL,
    description             text                   NOT NULL,
    municipality_logo_path  text,
    id_background_front_path text,
    id_background_back_path  text,
    created_at              timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at              timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.municipalities_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.municipalities_id_seq OWNED BY public.municipalities.id;
ALTER TABLE ONLY public.municipalities ALTER COLUMN id SET DEFAULT nextval('public.municipalities_id_seq'::regclass);


CREATE TABLE public.barangays (
    id                          integer NOT NULL,
    municipality_id             integer NOT NULL,
    barangay_name               character varying(50) NOT NULL,
    barangay_code               character varying(20) NOT NULL,
    barangay_logo_path          text,
    certificate_background_path text,
    organizational_chart_path   text,
    contact_number              character varying(50),
    email                       character varying(50),
    gis_code                    character varying(20),
    created_at                  timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.barangays_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.barangays_id_seq OWNED BY public.barangays.id;
ALTER TABLE ONLY public.barangays ALTER COLUMN id SET DEFAULT nextval('public.barangays_id_seq'::regclass);


CREATE SEQUENCE public.puroks_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE public.puroks (
    id          integer NOT NULL DEFAULT nextval('public.puroks_id_seq'::regclass),
    barangay_id integer NOT NULL,
    purok_name  character varying(50) NOT NULL,
    purok_leader character varying(50),
    description text,
    created_at  timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at  timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER SEQUENCE public.puroks_id_seq OWNED BY public.puroks.id;


CREATE TABLE public.gis_municipality (
    id                   integer NOT NULL,
    name                 character varying(50),
    gis_municipality_code character varying(20),
    geom                 public.geometry(Geometry, 4326),
    shape_sqkm           numeric(23, 15)
);
CREATE SEQUENCE public.gis_municipality_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.gis_municipality_id_seq OWNED BY public.gis_municipality.id;
ALTER TABLE ONLY public.gis_municipality ALTER COLUMN id SET DEFAULT nextval('public.gis_municipality_id_seq'::regclass);


CREATE TABLE public.gis_barangay (
    id                    integer NOT NULL,
    name                  character varying(50),
    gis_barangay_code     character varying(20),
    gis_municipality_code character varying(20),
    geom                  public.geometry(Geometry, 4326),
    shape_sqkm            numeric(23, 15)
);
CREATE SEQUENCE public.gis_barangay_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.gis_barangay_id_seq OWNED BY public.gis_barangay.id;
ALTER TABLE ONLY public.gis_barangay ALTER COLUMN id SET DEFAULT nextval('public.gis_barangay_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- People / Residency
-- ---------------------------------------------------------------------------

CREATE TABLE public.residents (
    id                   character varying(20) NOT NULL,  -- custom format: RES-YYYY-NNN
    barangay_id          integer NOT NULL,
    last_name            character varying(50) NOT NULL,
    first_name           character varying(50) NOT NULL,
    middle_name          character varying(50),
    suffix               character varying(10),
    sex                  character varying(10) NOT NULL,
    civil_status         character varying(25) NOT NULL,
    birthdate            date NOT NULL,
    birthplace           text,
    contact_number       character varying(50),
    email                character varying(100),
    occupation           text,
    monthly_income       numeric(10, 2),
    employment_status    character varying(20),
    education_attainment character varying(30),
    resident_status      character varying(20) DEFAULT 'active'::character varying,
    picture_path         text,
    indigenous_person    boolean DEFAULT false,
    created_at           timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at           timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT residents_sex_check          CHECK (sex          IN ('male', 'female')),
    CONSTRAINT residents_civil_status_check CHECK (civil_status IN ('single','married','widowed','separated','divorced','live_in')),
    CONSTRAINT residents_employment_status_check CHECK (employment_status IN ('employed','unemployed','self-employed','student','retired','not_applicable')),
    CONSTRAINT residents_resident_status_check  CHECK (resident_status  IN ('active','deceased','moved_out','temporarily_away'))
);


CREATE TABLE public.resident_classifications (
    id                     integer NOT NULL,
    resident_id            character varying(20),
    classification_type    character varying(50) NOT NULL,
    classification_details jsonb DEFAULT '[]'::jsonb
);
CREATE SEQUENCE public.resident_classifications_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.resident_classifications_id_seq OWNED BY public.resident_classifications.id;
ALTER TABLE ONLY public.resident_classifications ALTER COLUMN id SET DEFAULT nextval('public.resident_classifications_id_seq'::regclass);


CREATE TABLE public.resident_counters (
    year    integer NOT NULL,
    counter integer DEFAULT 0 NOT NULL,
    prefix  character(4) NOT NULL
);


CREATE TABLE public.classification_types (
    id              integer NOT NULL,
    municipality_id integer NOT NULL,
    name            character varying(100) NOT NULL,
    description     text,
    color           character varying(7) DEFAULT '#4CAF50'::character varying,
    details         jsonb DEFAULT '[]'::jsonb,
    is_active       boolean DEFAULT true,
    created_at      timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.classification_types_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.classification_types_id_seq OWNED BY public.classification_types.id;
ALTER TABLE ONLY public.classification_types ALTER COLUMN id SET DEFAULT nextval('public.classification_types_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- Household / Family
-- ---------------------------------------------------------------------------

CREATE TABLE public.households (
    id                   integer NOT NULL,
    house_number         character varying(10),
    street               character varying(50),
    purok_id             integer NOT NULL,
    barangay_id          integer NOT NULL,
    house_head           character varying(20) NOT NULL,
    housing_type         character varying(30),
    structure_type       character varying(30),
    electricity          boolean DEFAULT false,
    water_source         character varying(30),
    toilet_facility      character varying(30),
    geom                 public.geometry(Geometry, 4326),
    area                 numeric(10, 2),
    household_image_path text,
    created_at           timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at           timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.households_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.households_id_seq OWNED BY public.households.id;
ALTER TABLE ONLY public.households ALTER COLUMN id SET DEFAULT nextval('public.households_id_seq'::regclass);


CREATE TABLE public.families (
    id           integer NOT NULL,
    household_id integer NOT NULL,
    family_group character varying(20) NOT NULL,
    family_head  character varying(20) NOT NULL,
    created_at   timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at   timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.families_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.families_id_seq OWNED BY public.families.id;
ALTER TABLE ONLY public.families ALTER COLUMN id SET DEFAULT nextval('public.families_id_seq'::regclass);


CREATE TABLE public.family_members (
    id                  integer NOT NULL,
    family_id           integer NOT NULL,
    family_member       character varying(20) NOT NULL,
    relationship_to_head character varying(50),
    created_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.family_members_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.family_members_id_seq OWNED BY public.family_members.id;
ALTER TABLE ONLY public.family_members ALTER COLUMN id SET DEFAULT nextval('public.family_members_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- Officials / Requests / Inventory / Archives
-- ---------------------------------------------------------------------------

CREATE TABLE public.officials (
    id              integer NOT NULL,
    barangay_id     integer NOT NULL,
    resident_id     character varying(20) NOT NULL,
    position        character varying(100) NOT NULL,
    committee       character varying(50),
    term_start      date NOT NULL,
    term_end        date,
    responsibilities text,
    created_at      timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.officials_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.officials_id_seq OWNED BY public.officials.id;
ALTER TABLE ONLY public.officials ALTER COLUMN id SET DEFAULT nextval('public.officials_id_seq'::regclass);


CREATE TABLE public.requests (
    id               integer NOT NULL,
    resident_id      character varying(20),
    full_name        character varying(200),
    contact_number   character varying(50),
    email            character varying(50),
    address          text,
    barangay_id      integer NOT NULL,
    type             character varying(50) NOT NULL,
    status           character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    certificate_type character varying(100),
    urgency          character varying(50) DEFAULT 'normal'::character varying,
    purpose          text NOT NULL,
    requirements     jsonb,
    appointment_with character varying(255),
    appointment_date date,
    notes            text,
    created_at       timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at       timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    uuid             uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT requests_type_check    CHECK (type    IN ('certificate', 'appointment')),
    CONSTRAINT requests_status_check  CHECK (status  IN ('pending', 'approved', 'rejected', 'completed')),
    CONSTRAINT requests_urgency_check CHECK (urgency IN ('normal', 'urgent', 'express'))
);
CREATE SEQUENCE public.requests_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.requests_id_seq OWNED BY public.requests.id;
ALTER TABLE ONLY public.requests ALTER COLUMN id SET DEFAULT nextval('public.requests_id_seq'::regclass);


CREATE TABLE public.inventories (
    id          integer NOT NULL,
    barangay_id integer NOT NULL,
    item_name   character varying(255) NOT NULL,
    item_type   character varying(50)  NOT NULL,
    description text NOT NULL,
    sponsors    character varying(50),
    quantity    integer DEFAULT 0 NOT NULL,
    unit        character varying(20),
    file_path   text,
    created_at  timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at  timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.inventories_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.inventories_id_seq OWNED BY public.inventories.id;
ALTER TABLE ONLY public.inventories ALTER COLUMN id SET DEFAULT nextval('public.inventories_id_seq'::regclass);


CREATE TABLE public.archives (
    id            integer NOT NULL,
    barangay_id   integer NOT NULL,
    title         character varying(255) NOT NULL,
    document_type character varying(50),
    description   text NOT NULL,
    author        character varying(50),
    signatory     character varying(50),
    relate_resident character varying(20),
    file_path     text,
    created_at    timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at    timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.archives_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.archives_id_seq OWNED BY public.archives.id;
ALTER TABLE ONLY public.archives ALTER COLUMN id SET DEFAULT nextval('public.archives_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- Health / Pets
-- ---------------------------------------------------------------------------

CREATE TABLE public.pets (
    id           integer NOT NULL,
    owner_id     character varying(20) NOT NULL,
    pet_name     character varying(50) NOT NULL,
    species      character varying(50) NOT NULL,
    breed        character varying(50) NOT NULL,
    sex          character varying(10) NOT NULL,
    birthdate    date NOT NULL,
    color        character varying(20) NOT NULL,
    picture_path text,
    description  text,
    created_at   timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at   timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    uuid         uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT pets_sex_check CHECK (sex IN ('male', 'female'))
);
CREATE SEQUENCE public.pets_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.pets_id_seq OWNED BY public.pets.id;
ALTER TABLE ONLY public.pets ALTER COLUMN id SET DEFAULT nextval('public.pets_id_seq'::regclass);


CREATE TABLE public.vaccines (
    id                  integer NOT NULL,
    target_type         character varying(10) NOT NULL,
    target_id           character varying(20) NOT NULL,
    vaccine_name        character varying(100) NOT NULL,
    vaccine_type        character varying(100),
    vaccine_description text,
    vaccination_date    date NOT NULL,
    created_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vaccines_target_type_check CHECK (target_type IN ('pet', 'resident'))
);
CREATE SEQUENCE public.vaccines_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.vaccines_id_seq OWNED BY public.vaccines.id;
ALTER TABLE ONLY public.vaccines ALTER COLUMN id SET DEFAULT nextval('public.vaccines_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- BIMS Auth (renamed from users)
-- ---------------------------------------------------------------------------

CREATE TABLE public.bims_users (
    id                   integer NOT NULL,
    target_type          character varying(15) NOT NULL,
    target_id            character varying(20) NOT NULL,
    full_name            character varying(100) NOT NULL,
    email                character varying(100) NOT NULL,
    password             text NOT NULL,
    role                 character varying(20) NOT NULL,
    picture_path         text,
    last_login           timestamp without time zone,
    failed_login_attempts integer DEFAULT 0,
    is_active            boolean DEFAULT true,
    reset_token          text,
    reset_token_expiry   timestamp without time zone,
    created_at           timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at           timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bims_users_role_check        CHECK (role        IN ('admin', 'staff')),
    CONSTRAINT bims_users_target_type_check CHECK (target_type IN ('municipality', 'barangay'))
);
CREATE SEQUENCE public.bims_users_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.bims_users_id_seq OWNED BY public.bims_users.id;
ALTER TABLE ONLY public.bims_users ALTER COLUMN id SET DEFAULT nextval('public.bims_users_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- BIMS API Keys
-- Source: server/src/models/ApiKey.js (ensureTable)
-- ---------------------------------------------------------------------------

CREATE TABLE public.api_keys (
    id                    integer NOT NULL,
    key                   text    NOT NULL,                          -- UNIQUE enforced below
    name                  character varying(100) NOT NULL,
    municipality_id       integer NOT NULL,                          -- NOT NULL per ApiKey.js
    scopes                text[]  NOT NULL DEFAULT ARRAY['read']::text[],  -- TEXT[] per ApiKey.js (not jsonb)
    rate_limit_per_minute integer DEFAULT 60,
    expires_at            timestamp without time zone,
    revoked               boolean DEFAULT false,
    created_by_user_id    integer NOT NULL,                          -- references bims_users(id)
    last_used_at          timestamp without time zone,               -- tracked by markUsed()
    created_at            timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at            timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.api_keys_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;
ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- BIMS Audit Logs
-- ---------------------------------------------------------------------------

CREATE TABLE public.audit_logs (
    id          integer NOT NULL,
    barangay_id integer,
    table_name  character varying(50) NOT NULL,
    operation   character varying(10) NOT NULL,
    record_id   character varying(20) NOT NULL,
    old_values  jsonb,
    new_values  jsonb,
    changed_by  integer,   -- references bims_users(id)
    changed_at  timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE public.audit_logs_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;
ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


-- =============================================================================
-- E-SERVICES TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- E-Services Auth (renamed from users)
-- ---------------------------------------------------------------------------

CREATE TABLE public.eservice_users (
    id         text    NOT NULL DEFAULT gen_random_uuid()::text,
    email      text    NOT NULL,
    password   text    NOT NULL,
    name       text    NOT NULL,
    role       text    NOT NULL DEFAULT 'admin',
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


CREATE TABLE public.roles (
    id          text NOT NULL DEFAULT gen_random_uuid()::text,
    name        text NOT NULL,
    description text,
    created_at  timestamp without time zone DEFAULT now(),
    updated_at  timestamp without time zone DEFAULT now()
);


CREATE TABLE public.permissions (
    id         text NOT NULL DEFAULT gen_random_uuid()::text,
    resource   text NOT NULL,
    action     public.permission_action NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


CREATE TABLE public.role_permissions (
    id            text NOT NULL DEFAULT gen_random_uuid()::text,
    role_id       text NOT NULL,
    permission_id text NOT NULL,
    created_at    timestamp without time zone DEFAULT now()
);


CREATE TABLE public.user_roles (
    id         text NOT NULL DEFAULT gen_random_uuid()::text,
    user_id    text NOT NULL,
    role_id    text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


CREATE TABLE public.refresh_tokens (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    user_id        text,
    subscriber_id  text,
    token          text NOT NULL,
    device_info    text,
    ip_address     text,
    user_agent     text,
    expires_at     timestamp without time zone NOT NULL,
    revoked_at     timestamp without time zone,
    revoked_reason text,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


CREATE TABLE public.sessions (
    id               text NOT NULL DEFAULT gen_random_uuid()::text,
    user_id          text,
    subscriber_id    text,
    refresh_token_id text NOT NULL,
    ip_address       text,
    user_agent       text,
    device_info      text,
    last_activity_at timestamp without time zone DEFAULT now(),
    created_at       timestamp without time zone DEFAULT now(),
    expires_at       timestamp without time zone NOT NULL
);


-- ---------------------------------------------------------------------------
-- Subscribers / Citizens / Non-Citizens
-- ---------------------------------------------------------------------------

CREATE TABLE public.citizens (
    id                           text NOT NULL DEFAULT gen_random_uuid()::text,
    first_name                   text NOT NULL,
    middle_name                  text,
    last_name                    text NOT NULL,
    extension_name               text,
    email                        text,
    phone_number                 text,
    citizen_picture              text,
    birth_date                   timestamp without time zone NOT NULL,
    civil_status                 text NOT NULL,
    sex                          text NOT NULL,
    username                     text,
    pin                          text,
    resident_id                  text,   -- soft link to residents.id (enforced via citizen_resident_mapping)
    residency_status             public.citizen_status NOT NULL DEFAULT 'PENDING',
    residency_application_remarks text,
    is_resident                  boolean NOT NULL DEFAULT false,
    is_voter                     boolean NOT NULL DEFAULT false,
    proof_of_identification      text,
    address                      text,
    is_employed                  boolean NOT NULL DEFAULT false,
    citizenship                  text,
    acr_no                       text,
    profession                   text,
    height                       text,
    weight                       text,
    address_barangay             text,
    address_municipality         text,
    address_postal_code          text,
    address_province             text,
    address_region               text,
    address_street_address       text,
    emergency_contact_number     text,
    emergency_contact_person     text,
    id_type                      text,
    id_document_number           text,
    spouse_name                  text,
    created_at                   timestamp without time zone DEFAULT now(),
    updated_at                   timestamp without time zone DEFAULT now()
);


CREATE TABLE public.non_citizens (
    id               text NOT NULL DEFAULT gen_random_uuid()::text,
    first_name       text NOT NULL,
    middle_name      text,
    last_name        text NOT NULL,
    extension_name   text,
    email            text,
    phone_number     text NOT NULL,
    resident_id      text,
    residency_status text,
    profile_picture  text,
    birth_date       timestamp without time zone,
    civil_status     text,
    sex              text,
    resident_address text,
    status           public.subscriber_status NOT NULL DEFAULT 'PENDING',
    residency_type   public.residency_type,
    created_at       timestamp without time zone DEFAULT now(),
    updated_at       timestamp without time zone DEFAULT now()
);


CREATE TABLE public.subscribers (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    type           public.person_type NOT NULL,
    citizen_id     text,
    non_citizen_id text,
    password       text,
    google_id      text,
    google_email   text,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


CREATE TABLE public.citizen_registration_requests (
    id            text NOT NULL DEFAULT gen_random_uuid()::text,
    status        public.registration_status NOT NULL DEFAULT 'PENDING',
    admin_notes   text,
    reviewed_by   text,
    reviewed_at   timestamp without time zone,
    citizen_id    text NOT NULL,
    selfie_url    text,
    subscriber_id text,
    created_at    timestamp without time zone DEFAULT now(),
    updated_at    timestamp without time zone DEFAULT now()
);


CREATE TABLE public.place_of_birth (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    region         text NOT NULL,
    province       text NOT NULL,
    municipality   text NOT NULL,
    citizen_id     text,
    non_citizen_id text,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


CREATE TABLE public.mother_info (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    first_name     text,
    middle_name    text,
    last_name      text,
    non_citizen_id text NOT NULL,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- Services / E-Services
-- ---------------------------------------------------------------------------

CREATE TABLE public.services (
    id                        text NOT NULL DEFAULT gen_random_uuid()::text,
    code                      text NOT NULL,
    name                      text NOT NULL,
    description               text,
    category                  text,
    icon                      text,
    "order"                   integer NOT NULL DEFAULT 0,
    is_active                 boolean NOT NULL DEFAULT true,
    requires_payment          boolean NOT NULL DEFAULT true,
    default_amount            numeric(65, 30),
    payment_statuses          jsonb,
    form_fields               jsonb,
    display_in_sidebar        boolean NOT NULL DEFAULT true,
    display_in_subscriber_tabs boolean NOT NULL DEFAULT true,
    appointment_duration      integer,
    requires_appointment      boolean NOT NULL DEFAULT false,
    created_at                timestamp without time zone DEFAULT now(),
    updated_at                timestamp without time zone DEFAULT now()
);


CREATE TABLE public.eservices (
    id              text NOT NULL DEFAULT gen_random_uuid()::text,
    code            text NOT NULL,
    name            text NOT NULL,
    description     text,
    category        text,
    icon            text,
    "order"         integer NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    requires_payment boolean NOT NULL DEFAULT false,
    default_amount  numeric(65, 30),
    created_at      timestamp without time zone DEFAULT now(),
    updated_at      timestamp without time zone DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

CREATE TABLE public.transactions (
    id                              text NOT NULL DEFAULT gen_random_uuid()::text,
    subscriber_id                   text NOT NULL,
    transaction_id                  text NOT NULL,
    reference_number                text NOT NULL,
    payment_status                  text NOT NULL DEFAULT 'PENDING',
    payment_amount                  numeric(65, 30) NOT NULL DEFAULT 0,
    transmital_no                   text,
    reference_number_generated_at   timestamp without time zone,
    is_resident_of_borongan         boolean NOT NULL DEFAULT false,
    permit_type                     text,
    status                          text,
    is_posted                       boolean NOT NULL DEFAULT false,
    valid_id_to_present             text,
    remarks                         text,
    service_id                      text NOT NULL,
    service_data                    jsonb,
    application_date                timestamp without time zone,
    preferred_appointment_date      timestamp without time zone,
    scheduled_appointment_date      timestamp without time zone,
    appointment_status              public.appointment_status DEFAULT 'PENDING',
    update_request_status           public.update_request_status NOT NULL DEFAULT 'NONE',
    update_request_description      text,
    update_requested_by             public.update_requested_by,
    pending_service_data            jsonb,
    admin_update_request_description text,
    created_at                      timestamp without time zone DEFAULT now(),
    updated_at                      timestamp without time zone DEFAULT now()
);


CREATE TABLE public.transaction_notes (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    transaction_id text NOT NULL,
    message        text NOT NULL,
    sender_type    public.transaction_note_sender_type NOT NULL,
    sender_id      text NOT NULL,
    is_internal    boolean NOT NULL DEFAULT false,
    is_read        boolean NOT NULL DEFAULT false,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


CREATE TABLE public.appointment_notes (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    transaction_id text NOT NULL,
    type           public.appointment_note_type NOT NULL,
    note           text NOT NULL,
    created_by     text,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- Tax & Payments
-- ---------------------------------------------------------------------------

CREATE TABLE public.tax_profiles (
    id         text NOT NULL DEFAULT gen_random_uuid()::text,
    service_id text NOT NULL,
    name       text NOT NULL,
    variant    text,
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


CREATE TABLE public.tax_profile_versions (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    tax_profile_id text NOT NULL,
    version        text NOT NULL,
    effective_from timestamp without time zone NOT NULL,
    effective_to   timestamp without time zone,
    status         public.tax_version_status NOT NULL DEFAULT 'DRAFT',
    change_reason  text NOT NULL,
    configuration  jsonb NOT NULL,
    created_by     text NOT NULL,
    created_at     timestamp without time zone DEFAULT now()
);


CREATE TABLE public.tax_computations (
    id                      text NOT NULL DEFAULT gen_random_uuid()::text,
    transaction_id          text NOT NULL,
    tax_profile_version_id  text NOT NULL,
    is_active               boolean NOT NULL DEFAULT true,
    inputs                  jsonb NOT NULL,
    derived_values          jsonb NOT NULL,
    breakdown               jsonb NOT NULL,
    total_tax               numeric(65, 30) NOT NULL,
    adjusted_tax            numeric(65, 30),
    is_reassessment         boolean NOT NULL DEFAULT false,
    reassessment_reason     text,
    previous_computation_id text,
    difference_amount       numeric(65, 30),
    exemptions_applied      jsonb,
    discounts_applied       jsonb,
    penalties_applied       jsonb,
    computed_at             timestamp without time zone DEFAULT now(),
    computed_by             text
);


CREATE TABLE public.exemptions (
    id                   text NOT NULL DEFAULT gen_random_uuid()::text,
    transaction_id       text NOT NULL,
    tax_computation_id   text,
    exemption_type       public.exemption_type NOT NULL,
    status               public.exemption_status NOT NULL DEFAULT 'PENDING',
    requested_by         text NOT NULL,
    approved_by          text,
    request_reason       text NOT NULL,
    rejection_reason     text,
    supporting_documents jsonb,
    exemption_amount     numeric(65, 30),
    approved_at          timestamp without time zone,
    rejected_at          timestamp without time zone,
    created_at           timestamp without time zone DEFAULT now(),
    updated_at           timestamp without time zone DEFAULT now()
);


CREATE TABLE public.payments (
    id                text NOT NULL DEFAULT gen_random_uuid()::text,
    transaction_id    text NOT NULL,
    tax_computation_id text NOT NULL,
    amount            numeric(65, 30) NOT NULL,
    payment_method    public.payment_method NOT NULL,
    payment_date      timestamp without time zone DEFAULT now(),
    received_by       text NOT NULL,
    reference_number  text,
    notes             text,
    created_at        timestamp without time zone DEFAULT now(),
    updated_at        timestamp without time zone DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- Social Amelioration / Beneficiaries
-- ---------------------------------------------------------------------------

CREATE TABLE public.social_amelioration_settings (
    id          text NOT NULL DEFAULT gen_random_uuid()::text,
    type        public.social_amelioration_setting_type NOT NULL,
    name        text NOT NULL,
    description text,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamp without time zone DEFAULT now(),
    updated_at  timestamp without time zone DEFAULT now()
);


CREATE TABLE public.senior_citizen_beneficiaries (
    id               text NOT NULL DEFAULT gen_random_uuid()::text,
    citizen_id       text NOT NULL,
    senior_citizen_id text NOT NULL,
    status           public.beneficiary_status NOT NULL DEFAULT 'ACTIVE',
    remarks          text,
    created_at       timestamp without time zone DEFAULT now(),
    updated_at       timestamp without time zone DEFAULT now()
);


CREATE TABLE public.senior_citizen_pension_type_pivots (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    beneficiary_id text NOT NULL,
    setting_id     text NOT NULL
);


CREATE TABLE public.pwd_beneficiaries (
    id                 text NOT NULL DEFAULT gen_random_uuid()::text,
    citizen_id         text NOT NULL,
    pwd_id             text NOT NULL,
    disability_level   text NOT NULL,
    disability_type_id text NOT NULL,
    monetary_allowance boolean NOT NULL DEFAULT false,
    assisted_device    boolean NOT NULL DEFAULT false,
    donor_device       text,
    status             public.beneficiary_status NOT NULL DEFAULT 'ACTIVE',
    remarks            text,
    created_at         timestamp without time zone DEFAULT now(),
    updated_at         timestamp without time zone DEFAULT now()
);


CREATE TABLE public.student_beneficiaries (
    id            text NOT NULL DEFAULT gen_random_uuid()::text,
    citizen_id    text NOT NULL,
    student_id    text NOT NULL,
    grade_level_id text NOT NULL,
    status        public.beneficiary_status NOT NULL DEFAULT 'ACTIVE',
    remarks       text,
    created_at    timestamp without time zone DEFAULT now(),
    updated_at    timestamp without time zone DEFAULT now()
);


CREATE TABLE public.solo_parent_beneficiaries (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    citizen_id     text NOT NULL,
    solo_parent_id text NOT NULL,
    category_id    text NOT NULL,
    status         public.beneficiary_status NOT NULL DEFAULT 'ACTIVE',
    remarks        text,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


CREATE TABLE public.government_programs (
    id          text NOT NULL DEFAULT gen_random_uuid()::text,
    name        text NOT NULL,
    description text,
    type        public.government_program_type NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamp without time zone DEFAULT now(),
    updated_at  timestamp without time zone DEFAULT now()
);


CREATE TABLE public.beneficiary_program_pivots (
    id               text NOT NULL DEFAULT gen_random_uuid()::text,
    beneficiary_type public.beneficiary_type NOT NULL,
    beneficiary_id   text NOT NULL,
    program_id       text NOT NULL,
    created_at       timestamp without time zone DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- Utility / Other
-- ---------------------------------------------------------------------------

CREATE TABLE public.addresses (
    id             text NOT NULL DEFAULT gen_random_uuid()::text,
    region         text NOT NULL,
    province       text NOT NULL,
    municipality   text NOT NULL,
    barangay       text NOT NULL,
    postal_code    text NOT NULL,
    street_address text,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamp without time zone DEFAULT now(),
    updated_at     timestamp without time zone DEFAULT now()
);


CREATE TABLE public.otp_verifications (
    id           text NOT NULL DEFAULT gen_random_uuid()::text,
    phone_number text NOT NULL,
    code         text NOT NULL,
    expires_at   timestamp without time zone NOT NULL,
    is_used      boolean NOT NULL DEFAULT false,
    attempts     integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    created_at   timestamp without time zone DEFAULT now(),
    updated_at   timestamp without time zone DEFAULT now()
);


CREATE TABLE public.faqs (
    id         text NOT NULL DEFAULT gen_random_uuid()::text,
    question   text NOT NULL,
    answer     text NOT NULL,
    "order"    integer NOT NULL DEFAULT 0,
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


-- =============================================================================
-- BRIDGE TABLES
-- =============================================================================

-- citizen_resident_mapping: links E-Services citizens to BIMS residents.
-- Populated by the fuzzy matching pipeline in migrations/03_fuzzy_match.sql.
CREATE TABLE public.citizen_resident_mapping (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    citizen_id    text        NOT NULL,   -- references citizens(id)
    resident_id   character varying(20) NOT NULL,  -- references residents(id)
    match_score   numeric(5, 2),          -- fuzzy confidence 0.00–100.00
    match_method  character varying(20),  -- 'AUTO_FUZZY' | 'MANUAL'
    status        character varying(20)   NOT NULL DEFAULT 'PENDING',
                  -- PENDING | CONFIRMED | REJECTED | NEEDS_REVIEW
    matched_by    character varying(100), -- staff who confirmed or rejected
    created_at    timestamptz NOT NULL DEFAULT now(),
    confirmed_at  timestamptz,
    CONSTRAINT citizen_resident_mapping_status_check
        CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'NEEDS_REVIEW'))
);


-- =============================================================================
-- PRIMARY KEY CONSTRAINTS
-- =============================================================================

-- BIMS
ALTER TABLE ONLY public.municipalities         ADD CONSTRAINT municipalities_pkey         PRIMARY KEY (id);
ALTER TABLE ONLY public.barangays              ADD CONSTRAINT barangays_pkey              PRIMARY KEY (id);
ALTER TABLE ONLY public.puroks                 ADD CONSTRAINT puroks_pkey                 PRIMARY KEY (id);
ALTER TABLE ONLY public.gis_municipality       ADD CONSTRAINT gis_municipality_pkey       PRIMARY KEY (id);
ALTER TABLE ONLY public.gis_barangay           ADD CONSTRAINT gis_barangay_pkey           PRIMARY KEY (id);
ALTER TABLE ONLY public.residents              ADD CONSTRAINT residents_pkey              PRIMARY KEY (id);
ALTER TABLE ONLY public.resident_classifications ADD CONSTRAINT resident_classifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.resident_counters      ADD CONSTRAINT resident_counters_pkey      PRIMARY KEY (year);
ALTER TABLE ONLY public.classification_types   ADD CONSTRAINT classification_types_pkey   PRIMARY KEY (id);
ALTER TABLE ONLY public.households             ADD CONSTRAINT households_pkey             PRIMARY KEY (id);
ALTER TABLE ONLY public.families               ADD CONSTRAINT families_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.family_members         ADD CONSTRAINT family_members_pkey         PRIMARY KEY (id);
ALTER TABLE ONLY public.officials              ADD CONSTRAINT officials_pkey              PRIMARY KEY (id);
ALTER TABLE ONLY public.requests               ADD CONSTRAINT requests_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.inventories            ADD CONSTRAINT inventories_pkey            PRIMARY KEY (id);
ALTER TABLE ONLY public.archives               ADD CONSTRAINT archives_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.pets                   ADD CONSTRAINT pets_pkey                   PRIMARY KEY (id);
ALTER TABLE ONLY public.vaccines               ADD CONSTRAINT vaccines_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.bims_users             ADD CONSTRAINT bims_users_pkey             PRIMARY KEY (id);
ALTER TABLE ONLY public.api_keys               ADD CONSTRAINT api_keys_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.audit_logs             ADD CONSTRAINT audit_logs_pkey             PRIMARY KEY (id);

-- BIMS unique constraints
ALTER TABLE ONLY public.municipalities         ADD CONSTRAINT municipalities_municipality_name_key UNIQUE (municipality_name);
ALTER TABLE ONLY public.barangays              ADD CONSTRAINT barangays_barangay_name_key          UNIQUE (barangay_name);
ALTER TABLE ONLY public.puroks                 ADD CONSTRAINT unique_purok_per_barangay            UNIQUE (barangay_id, purok_name);
ALTER TABLE ONLY public.classification_types   ADD CONSTRAINT classification_types_municipality_id_name_key UNIQUE (municipality_id, name);
ALTER TABLE ONLY public.pets                   ADD CONSTRAINT pets_uuid_unique                     UNIQUE (uuid);
ALTER TABLE ONLY public.requests               ADD CONSTRAINT requests_uuid_unique                 UNIQUE (uuid);
ALTER TABLE ONLY public.bims_users             ADD CONSTRAINT bims_users_email_key                 UNIQUE (email);
ALTER TABLE ONLY public.api_keys               ADD CONSTRAINT api_keys_key_unique                   UNIQUE (key);

-- E-Services
ALTER TABLE ONLY public.eservice_users          ADD CONSTRAINT eservice_users_pkey         PRIMARY KEY (id);
ALTER TABLE ONLY public.roles                   ADD CONSTRAINT roles_pkey                  PRIMARY KEY (id);
ALTER TABLE ONLY public.permissions             ADD CONSTRAINT permissions_pkey            PRIMARY KEY (id);
ALTER TABLE ONLY public.role_permissions        ADD CONSTRAINT role_permissions_pkey       PRIMARY KEY (id);
ALTER TABLE ONLY public.user_roles              ADD CONSTRAINT user_roles_pkey             PRIMARY KEY (id);
ALTER TABLE ONLY public.refresh_tokens          ADD CONSTRAINT refresh_tokens_pkey         PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions                ADD CONSTRAINT sessions_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.citizens                ADD CONSTRAINT citizens_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.non_citizens            ADD CONSTRAINT non_citizens_pkey           PRIMARY KEY (id);
ALTER TABLE ONLY public.subscribers             ADD CONSTRAINT subscribers_pkey            PRIMARY KEY (id);
ALTER TABLE ONLY public.citizen_registration_requests ADD CONSTRAINT citizen_registration_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.place_of_birth          ADD CONSTRAINT place_of_birth_pkey         PRIMARY KEY (id);
ALTER TABLE ONLY public.mother_info             ADD CONSTRAINT mother_info_pkey            PRIMARY KEY (id);
ALTER TABLE ONLY public.services                ADD CONSTRAINT services_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.eservices               ADD CONSTRAINT eservices_pkey              PRIMARY KEY (id);
ALTER TABLE ONLY public.transactions            ADD CONSTRAINT transactions_pkey           PRIMARY KEY (id);
ALTER TABLE ONLY public.transaction_notes       ADD CONSTRAINT transaction_notes_pkey      PRIMARY KEY (id);
ALTER TABLE ONLY public.appointment_notes       ADD CONSTRAINT appointment_notes_pkey      PRIMARY KEY (id);
ALTER TABLE ONLY public.tax_profiles            ADD CONSTRAINT tax_profiles_pkey           PRIMARY KEY (id);
ALTER TABLE ONLY public.tax_profile_versions    ADD CONSTRAINT tax_profile_versions_pkey   PRIMARY KEY (id);
ALTER TABLE ONLY public.tax_computations        ADD CONSTRAINT tax_computations_pkey       PRIMARY KEY (id);
ALTER TABLE ONLY public.exemptions              ADD CONSTRAINT exemptions_pkey             PRIMARY KEY (id);
ALTER TABLE ONLY public.payments                ADD CONSTRAINT payments_pkey               PRIMARY KEY (id);
ALTER TABLE ONLY public.social_amelioration_settings ADD CONSTRAINT social_amelioration_settings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.senior_citizen_beneficiaries ADD CONSTRAINT senior_citizen_beneficiaries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.senior_citizen_pension_type_pivots ADD CONSTRAINT senior_citizen_pension_type_pivots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pwd_beneficiaries       ADD CONSTRAINT pwd_beneficiaries_pkey      PRIMARY KEY (id);
ALTER TABLE ONLY public.student_beneficiaries   ADD CONSTRAINT student_beneficiaries_pkey  PRIMARY KEY (id);
ALTER TABLE ONLY public.solo_parent_beneficiaries ADD CONSTRAINT solo_parent_beneficiaries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.government_programs     ADD CONSTRAINT government_programs_pkey    PRIMARY KEY (id);
ALTER TABLE ONLY public.beneficiary_program_pivots ADD CONSTRAINT beneficiary_program_pivots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.addresses               ADD CONSTRAINT addresses_pkey              PRIMARY KEY (id);
ALTER TABLE ONLY public.otp_verifications       ADD CONSTRAINT otp_verifications_pkey      PRIMARY KEY (id);
ALTER TABLE ONLY public.faqs                    ADD CONSTRAINT faqs_pkey                   PRIMARY KEY (id);

-- E-Services unique constraints
ALTER TABLE ONLY public.eservice_users          ADD CONSTRAINT eservice_users_email_key    UNIQUE (email);
ALTER TABLE ONLY public.roles                   ADD CONSTRAINT roles_name_key              UNIQUE (name);
ALTER TABLE ONLY public.permissions             ADD CONSTRAINT permissions_resource_action_key UNIQUE (resource, action);
ALTER TABLE ONLY public.role_permissions        ADD CONSTRAINT role_permissions_role_id_permission_id_key UNIQUE (role_id, permission_id);
ALTER TABLE ONLY public.user_roles              ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);
ALTER TABLE ONLY public.citizens                ADD CONSTRAINT citizens_username_key       UNIQUE (username);
ALTER TABLE ONLY public.citizens                ADD CONSTRAINT citizens_resident_id_key    UNIQUE (resident_id);
ALTER TABLE ONLY public.non_citizens            ADD CONSTRAINT non_citizens_phone_number_key UNIQUE (phone_number);
ALTER TABLE ONLY public.non_citizens            ADD CONSTRAINT non_citizens_resident_id_key UNIQUE (resident_id);
ALTER TABLE ONLY public.subscribers             ADD CONSTRAINT subscribers_citizen_id_key    UNIQUE (citizen_id);
ALTER TABLE ONLY public.subscribers             ADD CONSTRAINT subscribers_non_citizen_id_key UNIQUE (non_citizen_id);
ALTER TABLE ONLY public.subscribers             ADD CONSTRAINT subscribers_google_id_key     UNIQUE (google_id);
ALTER TABLE ONLY public.citizen_registration_requests ADD CONSTRAINT citizen_registration_requests_citizen_id_key UNIQUE (citizen_id);
ALTER TABLE ONLY public.place_of_birth          ADD CONSTRAINT place_of_birth_non_citizen_id_key UNIQUE (non_citizen_id);
ALTER TABLE ONLY public.services                ADD CONSTRAINT services_code_key           UNIQUE (code);
ALTER TABLE ONLY public.eservices               ADD CONSTRAINT eservices_code_key          UNIQUE (code);
ALTER TABLE ONLY public.transactions            ADD CONSTRAINT transactions_transaction_id_key UNIQUE (transaction_id);
ALTER TABLE ONLY public.transactions            ADD CONSTRAINT transactions_reference_number_key UNIQUE (reference_number);
ALTER TABLE ONLY public.tax_profile_versions    ADD CONSTRAINT tax_profile_versions_tax_profile_id_version_key UNIQUE (tax_profile_id, version);
ALTER TABLE ONLY public.senior_citizen_beneficiaries ADD CONSTRAINT senior_citizen_beneficiaries_citizen_id_key     UNIQUE (citizen_id);
ALTER TABLE ONLY public.senior_citizen_beneficiaries ADD CONSTRAINT senior_citizen_beneficiaries_senior_citizen_id_key UNIQUE (senior_citizen_id);
ALTER TABLE ONLY public.senior_citizen_pension_type_pivots ADD CONSTRAINT senior_citizen_pension_type_pivots_beneficiary_id_setting_id_key UNIQUE (beneficiary_id, setting_id);
ALTER TABLE ONLY public.pwd_beneficiaries       ADD CONSTRAINT pwd_beneficiaries_citizen_id_key UNIQUE (citizen_id);
ALTER TABLE ONLY public.pwd_beneficiaries       ADD CONSTRAINT pwd_beneficiaries_pwd_id_key     UNIQUE (pwd_id);
ALTER TABLE ONLY public.student_beneficiaries   ADD CONSTRAINT student_beneficiaries_citizen_id_key UNIQUE (citizen_id);
ALTER TABLE ONLY public.student_beneficiaries   ADD CONSTRAINT student_beneficiaries_student_id_key UNIQUE (student_id);
ALTER TABLE ONLY public.solo_parent_beneficiaries ADD CONSTRAINT solo_parent_beneficiaries_citizen_id_key    UNIQUE (citizen_id);
ALTER TABLE ONLY public.solo_parent_beneficiaries ADD CONSTRAINT solo_parent_beneficiaries_solo_parent_id_key UNIQUE (solo_parent_id);
ALTER TABLE ONLY public.beneficiary_program_pivots ADD CONSTRAINT beneficiary_program_pivots_beneficiary_type_beneficiary_id_pro_key UNIQUE (beneficiary_type, beneficiary_id, program_id);
ALTER TABLE ONLY public.mother_info             ADD CONSTRAINT mother_info_non_citizen_id_key UNIQUE (non_citizen_id);

-- Bridge table unique constraints
ALTER TABLE ONLY public.citizen_resident_mapping ADD CONSTRAINT citizen_resident_mapping_citizen_id_key  UNIQUE (citizen_id);
ALTER TABLE ONLY public.citizen_resident_mapping ADD CONSTRAINT citizen_resident_mapping_resident_id_key UNIQUE (resident_id);


-- =============================================================================
-- INDEXES
-- =============================================================================

-- BIMS indexes
CREATE INDEX idx_municipalities_code         ON public.municipalities     USING btree (municipality_code);
CREATE INDEX idx_municipalities_gis_code     ON public.municipalities     USING btree (gis_code);
CREATE INDEX idx_municipalities_province     ON public.municipalities     USING btree (province);
CREATE INDEX idx_municipalities_region       ON public.municipalities     USING btree (region);

CREATE INDEX idx_barangays_code              ON public.barangays          USING btree (barangay_code);
CREATE INDEX idx_barangays_gis_code          ON public.barangays          USING btree (gis_code);
CREATE INDEX idx_barangays_municipality      ON public.barangays          USING btree (municipality_id);

CREATE INDEX idx_puroks_barangay             ON public.puroks             USING btree (barangay_id);
CREATE INDEX idx_puroks_barangay_name        ON public.puroks             USING btree (barangay_id, purok_name);
CREATE INDEX idx_puroks_name                 ON public.puroks             USING btree (purok_name);
CREATE INDEX idx_puroks_leader_optimized     ON public.puroks             USING btree (purok_leader) WHERE (purok_leader IS NOT NULL);
CREATE INDEX idx_puroks_search_optimized     ON public.puroks             USING gin (to_tsvector('english'::regconfig, (((((purok_name)::text || ' '::text) || (COALESCE(purok_leader, ''::character varying))::text) || ' '::text) || COALESCE(description, ''::text))));

CREATE INDEX idx_gis_barangay_code           ON public.gis_barangay       USING btree (gis_barangay_code);
CREATE INDEX idx_gis_barangay_codes          ON public.gis_barangay       USING btree (gis_barangay_code, gis_municipality_code);
CREATE INDEX idx_gis_barangay_geom           ON public.gis_barangay       USING gist (geom);
CREATE INDEX idx_gis_barangay_municipality   ON public.gis_barangay       USING btree (gis_municipality_code);
CREATE INDEX idx_gis_barangay_spatial        ON public.gis_barangay       USING gist (geom) WHERE (geom IS NOT NULL);
CREATE INDEX idx_gis_municipality_code       ON public.gis_municipality   USING btree (gis_municipality_code);
CREATE INDEX idx_gis_municipality_geom       ON public.gis_municipality   USING gist (geom);
CREATE INDEX idx_gis_municipality_spatial    ON public.gis_municipality   USING gist (geom) WHERE (geom IS NOT NULL);

CREATE INDEX idx_residents_barangay          ON public.residents          USING btree (barangay_id);
CREATE INDEX idx_residents_birthdate         ON public.residents          USING btree (birthdate);
CREATE INDEX idx_residents_birthdate_optimized ON public.residents        USING btree (birthdate) WHERE (birthdate IS NOT NULL);
CREATE INDEX idx_residents_first_name        ON public.residents          USING btree (first_name);
CREATE INDEX idx_residents_last_name         ON public.residents          USING btree (last_name);
CREATE INDEX idx_residents_status            ON public.residents          USING btree (resident_status);
CREATE INDEX idx_residents_search            ON public.residents          USING btree (barangay_id, last_name, first_name);
CREATE INDEX idx_residents_list_optimized    ON public.residents          USING btree (barangay_id, resident_status, last_name, first_name);
CREATE INDEX idx_residents_status_stats      ON public.residents          USING btree (barangay_id, resident_status, created_at);
CREATE INDEX idx_residents_age_groups        ON public.residents          USING btree (barangay_id, birthdate) WHERE (birthdate IS NOT NULL);
CREATE INDEX idx_residents_contact_optimized ON public.residents          USING btree (contact_number, email) WHERE ((contact_number IS NOT NULL) OR (email IS NOT NULL));
CREATE INDEX idx_residents_search_optimized  ON public.residents          USING gin (to_tsvector('english'::regconfig, (((((last_name)::text || ' '::text) || (first_name)::text) || ' '::text) || (COALESCE(middle_name, ''::character varying))::text)));

CREATE INDEX idx_resident_classifications_resident  ON public.resident_classifications USING btree (resident_id);
CREATE INDEX idx_resident_classifications_type      ON public.resident_classifications USING btree (classification_type);
CREATE INDEX idx_resident_classifications_optimized ON public.resident_classifications USING btree (resident_id, classification_type);
CREATE INDEX idx_resident_classifications_details   ON public.resident_classifications USING gin (classification_details);
CREATE INDEX idx_classification_types_active        ON public.classification_types     USING btree (is_active);
CREATE INDEX idx_classification_types_municipality  ON public.classification_types     USING btree (municipality_id);
CREATE INDEX idx_classification_types_name          ON public.classification_types     USING btree (name);
CREATE INDEX idx_classification_types_details       ON public.classification_types     USING gin (details);

CREATE INDEX idx_households_barangay             ON public.households USING btree (barangay_id);
CREATE INDEX idx_households_purok                ON public.households USING btree (purok_id);
CREATE INDEX idx_households_head                 ON public.households USING btree (house_head);
CREATE INDEX idx_households_geom                 ON public.households USING gist (geom);
CREATE INDEX idx_households_geom_optimized       ON public.households USING gist (geom) WHERE (geom IS NOT NULL);
CREATE INDEX idx_households_purok_optimized      ON public.households USING btree (purok_id, barangay_id);
CREATE INDEX idx_households_location_optimized   ON public.households USING btree (barangay_id, purok_id, house_head);
CREATE INDEX idx_purok_stats_composite           ON public.households USING btree (purok_id, barangay_id, house_head);

CREATE INDEX idx_families_household              ON public.families USING btree (household_id);
CREATE INDEX idx_families_head                   ON public.families USING btree (family_head);
CREATE INDEX idx_family_members_family           ON public.family_members USING btree (family_id);
CREATE INDEX idx_family_members_member           ON public.family_members USING btree (family_member);

CREATE INDEX idx_officials_barangay              ON public.officials USING btree (barangay_id);
CREATE INDEX idx_officials_resident              ON public.officials USING btree (resident_id);
CREATE INDEX idx_officials_position              ON public.officials USING btree (position);
CREATE INDEX idx_officials_term                  ON public.officials USING btree (term_start, term_end);
CREATE INDEX idx_officials_active                ON public.officials USING btree (barangay_id, position) WHERE (term_end IS NULL);

CREATE INDEX idx_requests_barangay               ON public.requests USING btree (barangay_id);
CREATE INDEX idx_requests_resident               ON public.requests USING btree (resident_id);
CREATE INDEX idx_requests_status                 ON public.requests USING btree (status);
CREATE INDEX idx_requests_type                   ON public.requests USING btree (type);
CREATE INDEX idx_requests_created                ON public.requests USING btree (created_at);
CREATE INDEX idx_requests_status_type            ON public.requests USING btree (barangay_id, status, type, created_at);
CREATE INDEX idx_requests_pending                ON public.requests USING btree (barangay_id, created_at) WHERE ((status)::text = 'pending'::text);
CREATE UNIQUE INDEX idx_requests_uuid            ON public.requests USING btree (uuid);
CREATE INDEX idx_requests_requirements           ON public.requests USING gin (requirements);

CREATE INDEX idx_inventories_barangay            ON public.inventories USING btree (barangay_id);
CREATE INDEX idx_inventories_name                ON public.inventories USING btree (item_name);
CREATE INDEX idx_inventories_type                ON public.inventories USING btree (item_type);

CREATE INDEX idx_archives_barangay               ON public.archives USING btree (barangay_id);
CREATE INDEX idx_archives_type                   ON public.archives USING btree (document_type);
CREATE INDEX idx_archives_created                ON public.archives USING btree (created_at);

CREATE INDEX idx_pets_owner                      ON public.pets USING btree (owner_id);
CREATE INDEX idx_pets_species                    ON public.pets USING btree (species);
CREATE INDEX idx_pets_breed                      ON public.pets USING btree (breed);
CREATE UNIQUE INDEX idx_pets_uuid                ON public.pets USING btree (uuid);

CREATE INDEX idx_vaccines_target                 ON public.vaccines USING btree (target_type, target_id);
CREATE INDEX idx_vaccines_name                   ON public.vaccines USING btree (vaccine_name);
CREATE INDEX idx_vaccines_date                   ON public.vaccines USING btree (vaccination_date);

CREATE INDEX idx_bims_users_email                ON public.bims_users USING btree (email);
CREATE INDEX idx_bims_users_role                 ON public.bims_users USING btree (role);
CREATE INDEX idx_bims_users_active               ON public.bims_users USING btree (is_active);
CREATE INDEX idx_bims_users_target               ON public.bims_users USING btree (target_type, target_id);

CREATE INDEX idx_audit_logs_barangay_id          ON public.audit_logs USING btree (barangay_id);
CREATE INDEX idx_audit_logs_table_name           ON public.audit_logs USING btree (table_name);
CREATE INDEX idx_audit_logs_operation            ON public.audit_logs USING btree (operation);
CREATE INDEX idx_audit_logs_record_id            ON public.audit_logs USING btree (record_id);
CREATE INDEX idx_audit_logs_changed_at           ON public.audit_logs USING btree (changed_at);

-- E-Services indexes
CREATE INDEX idx_citizens_created_at          ON public.citizens    USING btree (created_at);
CREATE INDEX idx_citizens_residency_status    ON public.citizens    USING btree (residency_status);
CREATE INDEX idx_non_citizens_created_at      ON public.non_citizens USING btree (created_at);
CREATE INDEX idx_non_citizens_status          ON public.non_citizens USING btree (status);
CREATE INDEX idx_place_of_birth_citizen_id    ON public.place_of_birth USING btree (citizen_id);
CREATE INDEX idx_place_of_birth_non_citizen_id ON public.place_of_birth USING btree (non_citizen_id);
CREATE INDEX idx_refresh_tokens_user_id       ON public.refresh_tokens USING btree (user_id);
CREATE INDEX idx_refresh_tokens_subscriber_id ON public.refresh_tokens USING btree (subscriber_id);
CREATE INDEX idx_refresh_tokens_token         ON public.refresh_tokens USING btree (token);
CREATE INDEX idx_refresh_tokens_expires_at    ON public.refresh_tokens USING btree (expires_at);
CREATE INDEX idx_sessions_user_id             ON public.sessions USING btree (user_id);
CREATE INDEX idx_sessions_subscriber_id       ON public.sessions USING btree (subscriber_id);
CREATE INDEX idx_sessions_refresh_token_id    ON public.sessions USING btree (refresh_token_id);
CREATE INDEX idx_sessions_expires_at          ON public.sessions USING btree (expires_at);
CREATE INDEX idx_sessions_last_activity_at    ON public.sessions USING btree (last_activity_at);
CREATE INDEX idx_services_is_active           ON public.services USING btree (is_active);
CREATE INDEX idx_services_category            ON public.services USING btree (category);
CREATE INDEX idx_eservices_is_active          ON public.eservices USING btree (is_active);
CREATE INDEX idx_eservices_category           ON public.eservices USING btree (category);
CREATE INDEX idx_transactions_subscriber_id   ON public.transactions USING btree (subscriber_id);
CREATE INDEX idx_transactions_service_id      ON public.transactions USING btree (service_id);
CREATE INDEX idx_transactions_payment_status  ON public.transactions USING btree (payment_status);
CREATE INDEX idx_transactions_status          ON public.transactions USING btree (status);
CREATE INDEX idx_transactions_created_at      ON public.transactions USING btree (created_at);
CREATE INDEX idx_transactions_application_date ON public.transactions USING btree (application_date);
CREATE INDEX idx_transactions_update_request_status ON public.transactions USING btree (update_request_status);
CREATE INDEX idx_transaction_notes_transaction_id ON public.transaction_notes USING btree (transaction_id);
CREATE INDEX idx_transaction_notes_is_read    ON public.transaction_notes USING btree (is_read);
CREATE INDEX idx_appointment_notes_transaction_id ON public.appointment_notes USING btree (transaction_id);
CREATE INDEX idx_appointment_notes_type       ON public.appointment_notes USING btree (type);
CREATE INDEX idx_tax_profiles_service_id      ON public.tax_profiles USING btree (service_id);
CREATE INDEX idx_tax_profiles_is_active       ON public.tax_profiles USING btree (is_active);
CREATE INDEX idx_tax_profile_versions_tax_profile_id ON public.tax_profile_versions USING btree (tax_profile_id);
CREATE INDEX idx_tax_profile_versions_effective ON public.tax_profile_versions USING btree (effective_from, effective_to);
CREATE INDEX idx_tax_profile_versions_status  ON public.tax_profile_versions USING btree (status);
CREATE INDEX idx_tax_computations_transaction ON public.tax_computations USING btree (transaction_id, is_active);
CREATE INDEX idx_tax_computations_version     ON public.tax_computations USING btree (tax_profile_version_id);
CREATE INDEX idx_tax_computations_previous    ON public.tax_computations USING btree (previous_computation_id);
CREATE INDEX idx_exemptions_transaction_id    ON public.exemptions USING btree (transaction_id);
CREATE INDEX idx_exemptions_status            ON public.exemptions USING btree (status);
CREATE INDEX idx_payments_transaction_id      ON public.payments USING btree (transaction_id);
CREATE INDEX idx_payments_payment_date        ON public.payments USING btree (payment_date);
CREATE INDEX idx_social_amelioration_type     ON public.social_amelioration_settings USING btree (type);
CREATE INDEX idx_social_amelioration_active   ON public.social_amelioration_settings USING btree (is_active);
CREATE INDEX idx_government_programs_type     ON public.government_programs USING btree (type);
CREATE INDEX idx_government_programs_active   ON public.government_programs USING btree (is_active);
CREATE INDEX idx_beneficiary_pivots_type_id   ON public.beneficiary_program_pivots USING btree (beneficiary_type, beneficiary_id);
CREATE INDEX idx_beneficiary_pivots_program   ON public.beneficiary_program_pivots USING btree (program_id);
CREATE INDEX idx_addresses_region             ON public.addresses USING btree (region);
CREATE INDEX idx_addresses_province           ON public.addresses USING btree (province);
CREATE INDEX idx_addresses_municipality       ON public.addresses USING btree (municipality);
CREATE INDEX idx_addresses_is_active          ON public.addresses USING btree (is_active);
CREATE INDEX idx_otp_phone_number             ON public.otp_verifications USING btree (phone_number);
CREATE INDEX idx_otp_expires_at               ON public.otp_verifications USING btree (expires_at);
CREATE INDEX idx_otp_is_used                  ON public.otp_verifications USING btree (is_used);
CREATE INDEX idx_faqs_is_active               ON public.faqs USING btree (is_active);
CREATE INDEX idx_faqs_order                   ON public.faqs USING btree ("order");
CREATE INDEX idx_citizen_registration_status     ON public.citizen_registration_requests USING btree (status);
CREATE INDEX idx_citizen_registration_citizen_id ON public.citizen_registration_requests USING btree (citizen_id);
CREATE INDEX idx_citizen_registration_subscriber ON public.citizen_registration_requests USING btree (subscriber_id);

-- BIMS indexes present in source but missing from initial draft
-- (resident_classifications duplicate indexes kept for query planner compatibility)
CREATE INDEX idx_classification_types_search   ON public.resident_classifications USING btree (classification_type) WHERE (classification_type IS NOT NULL);
CREATE INDEX idx_classifications_stats         ON public.resident_classifications USING btree (classification_type) WHERE (classification_type IS NOT NULL);
CREATE INDEX idx_families_purok_optimized      ON public.families      USING btree (household_id);
CREATE INDEX idx_families_purok_stats          ON public.families      USING btree (household_id, family_head);
CREATE INDEX idx_family_members_purok_optimized ON public.family_members USING btree (family_id);
CREATE INDEX idx_family_members_purok_stats    ON public.family_members USING btree (family_id, family_member);
CREATE INDEX idx_gis_municipality_codes        ON public.gis_municipality USING btree (gis_municipality_code);
CREATE INDEX idx_households_search_optimized   ON public.households    USING btree (house_number, street) WHERE ((house_number IS NOT NULL) OR (street IS NOT NULL));
CREATE INDEX idx_officials_barangay_position   ON public.officials     USING btree (barangay_id, "position", term_start, term_end);
CREATE INDEX idx_pets_purok_optimized          ON public.pets          USING btree (owner_id);
CREATE INDEX idx_puroks_barangay_optimized     ON public.puroks        USING btree (barangay_id, purok_name);
CREATE INDEX idx_requests_search               ON public.requests      USING gin (to_tsvector('english'::regconfig, (((full_name)::text || ' '::text) || COALESCE(purpose, ''::text))));
CREATE INDEX idx_residents_purok_family_members ON public.residents    USING btree (id, barangay_id);
CREATE INDEX idx_residents_purok_house_heads   ON public.residents     USING btree (id, barangay_id);

-- E-Services indexes present in Prisma @@index but missing from initial draft
CREATE INDEX idx_transaction_notes_sender_type  ON public.transaction_notes USING btree (sender_type);
CREATE INDEX idx_payments_tax_computation_id    ON public.payments          USING btree (tax_computation_id);
CREATE INDEX idx_exemptions_tax_computation_id  ON public.exemptions        USING btree (tax_computation_id);

-- Bridge table indexes (used heavily by fuzzy match pipeline)
CREATE INDEX idx_crm_citizen_id    ON public.citizen_resident_mapping USING btree (citizen_id);
CREATE INDEX idx_crm_resident_id   ON public.citizen_resident_mapping USING btree (resident_id);
CREATE INDEX idx_crm_status        ON public.citizen_resident_mapping USING btree (status);
CREATE INDEX idx_crm_match_score   ON public.citizen_resident_mapping USING btree (match_score DESC);


-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- api_keys: dedicated updated_at function + trigger (from ApiKey.js ensureTable)
-- Using a dedicated function avoids dependency on session-level settings.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at_api_keys()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- BIMS: updated_at auto-stamp triggers
CREATE TRIGGER trigger_update_municipalities_updated_at  BEFORE UPDATE ON public.municipalities   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_barangays_updated_at       BEFORE UPDATE ON public.barangays         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_puroks_updated_at          BEFORE UPDATE ON public.puroks             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_residents_updated_at       BEFORE UPDATE ON public.residents          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_classification_types_updated_at BEFORE UPDATE ON public.classification_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_households_updated_at      BEFORE UPDATE ON public.households         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_families_updated_at        BEFORE UPDATE ON public.families           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_family_members_updated_at  BEFORE UPDATE ON public.family_members     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_officials_updated_at       BEFORE UPDATE ON public.officials          FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_requests_updated_at        BEFORE UPDATE ON public.requests           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_inventories_updated_at     BEFORE UPDATE ON public.inventories        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_archives_updated_at        BEFORE UPDATE ON public.archives           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_pets_updated_at            BEFORE UPDATE ON public.pets               FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_vaccines_updated_at        BEFORE UPDATE ON public.vaccines           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_update_bims_users_updated_at      BEFORE UPDATE ON public.bims_users         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_api_keys_set_updated_at               BEFORE UPDATE ON public.api_keys           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_api_keys();

-- BIMS: audit triggers
CREATE TRIGGER audit_residents_trigger      AFTER INSERT OR UPDATE OR DELETE ON public.residents    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_households_trigger     AFTER INSERT OR UPDATE OR DELETE ON public.households   FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_families_trigger       AFTER INSERT OR UPDATE OR DELETE ON public.families     FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_family_members_trigger AFTER INSERT OR UPDATE OR DELETE ON public.family_members FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_pets_trigger           AFTER INSERT OR UPDATE OR DELETE ON public.pets         FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_requests_trigger       AFTER INSERT OR UPDATE OR DELETE ON public.requests     FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_archives_trigger       AFTER INSERT OR UPDATE OR DELETE ON public.archives     FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_inventories_trigger    AFTER INSERT OR UPDATE OR DELETE ON public.inventories  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();


-- =============================================================================
-- FOREIGN KEY CONSTRAINTS
-- =============================================================================

-- BIMS foreign keys
ALTER TABLE ONLY public.barangays
    ADD CONSTRAINT barangays_municipality_id_fkey
    FOREIGN KEY (municipality_id) REFERENCES public.municipalities(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.puroks
    ADD CONSTRAINT puroks_barangay_id_fkey
    FOREIGN KEY (barangay_id) REFERENCES public.barangays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.classification_types
    ADD CONSTRAINT classification_types_municipality_id_fkey
    FOREIGN KEY (municipality_id) REFERENCES public.municipalities(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_barangay_id_fkey
    FOREIGN KEY (barangay_id) REFERENCES public.barangays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resident_classifications
    ADD CONSTRAINT resident_classifications_resident_id_fkey
    FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_barangay_id_fkey
    FOREIGN KEY (barangay_id) REFERENCES public.barangays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_purok_id_fkey
    FOREIGN KEY (purok_id) REFERENCES public.puroks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.households
    ADD CONSTRAINT households_house_head_fkey
    FOREIGN KEY (house_head) REFERENCES public.residents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.families
    ADD CONSTRAINT families_household_id_fkey
    FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.families
    ADD CONSTRAINT families_family_head_fkey
    FOREIGN KEY (family_head) REFERENCES public.residents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.family_members
    ADD CONSTRAINT family_members_family_id_fkey
    FOREIGN KEY (family_id) REFERENCES public.families(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.family_members
    ADD CONSTRAINT family_members_family_member_fkey
    FOREIGN KEY (family_member) REFERENCES public.residents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.officials
    ADD CONSTRAINT officials_barangay_id_fkey
    FOREIGN KEY (barangay_id) REFERENCES public.barangays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.officials
    ADD CONSTRAINT officials_resident_id_fkey
    FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_resident_id_fkey
    FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_barangay_id_fkey
    FOREIGN KEY (barangay_id) REFERENCES public.barangays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.archives
    ADD CONSTRAINT archives_barangay_id_fkey
    FOREIGN KEY (barangay_id) REFERENCES public.barangays(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pets
    ADD CONSTRAINT pets_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.residents(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_barangay_id_fkey
    FOREIGN KEY (barangay_id) REFERENCES public.barangays(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES public.bims_users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_municipality_id_fkey
    FOREIGN KEY (municipality_id) REFERENCES public.municipalities(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES public.bims_users(id) ON DELETE RESTRICT;

-- E-Services foreign keys
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.eservice_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey
    FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.eservice_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_subscriber_id_fkey
    FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.eservice_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_subscriber_id_fkey
    FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_refresh_token_id_fkey
    FOREIGN KEY (refresh_token_id) REFERENCES public.refresh_tokens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id);

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_non_citizen_id_fkey
    FOREIGN KEY (non_citizen_id) REFERENCES public.non_citizens(id);

ALTER TABLE ONLY public.citizen_registration_requests
    ADD CONSTRAINT citizen_registration_requests_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id);

ALTER TABLE ONLY public.citizen_registration_requests
    ADD CONSTRAINT citizen_registration_requests_subscriber_id_fkey
    FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id);

ALTER TABLE ONLY public.place_of_birth
    ADD CONSTRAINT place_of_birth_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.place_of_birth
    ADD CONSTRAINT place_of_birth_non_citizen_id_fkey
    FOREIGN KEY (non_citizen_id) REFERENCES public.non_citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mother_info
    ADD CONSTRAINT mother_info_non_citizen_id_fkey
    FOREIGN KEY (non_citizen_id) REFERENCES public.non_citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_subscriber_id_fkey
    FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public.services(id);

ALTER TABLE ONLY public.transaction_notes
    ADD CONSTRAINT transaction_notes_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.appointment_notes
    ADD CONSTRAINT appointment_notes_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tax_profile_versions
    ADD CONSTRAINT tax_profile_versions_tax_profile_id_fkey
    FOREIGN KEY (tax_profile_id) REFERENCES public.tax_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tax_computations
    ADD CONSTRAINT tax_computations_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.tax_computations
    ADD CONSTRAINT tax_computations_tax_profile_version_id_fkey
    FOREIGN KEY (tax_profile_version_id) REFERENCES public.tax_profile_versions(id);

ALTER TABLE ONLY public.tax_computations
    ADD CONSTRAINT tax_computations_previous_computation_id_fkey
    FOREIGN KEY (previous_computation_id) REFERENCES public.tax_computations(id);

ALTER TABLE ONLY public.exemptions
    ADD CONSTRAINT exemptions_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.exemptions
    ADD CONSTRAINT exemptions_tax_computation_id_fkey
    FOREIGN KEY (tax_computation_id) REFERENCES public.tax_computations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_transaction_id_fkey
    FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tax_computation_id_fkey
    FOREIGN KEY (tax_computation_id) REFERENCES public.tax_computations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.senior_citizen_beneficiaries
    ADD CONSTRAINT senior_citizen_beneficiaries_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.senior_citizen_pension_type_pivots
    ADD CONSTRAINT senior_citizen_pension_type_pivots_beneficiary_id_fkey
    FOREIGN KEY (beneficiary_id) REFERENCES public.senior_citizen_beneficiaries(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.senior_citizen_pension_type_pivots
    ADD CONSTRAINT senior_citizen_pension_type_pivots_setting_id_fkey
    FOREIGN KEY (setting_id) REFERENCES public.social_amelioration_settings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pwd_beneficiaries
    ADD CONSTRAINT pwd_beneficiaries_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pwd_beneficiaries
    ADD CONSTRAINT pwd_beneficiaries_disability_type_id_fkey
    FOREIGN KEY (disability_type_id) REFERENCES public.social_amelioration_settings(id);

ALTER TABLE ONLY public.student_beneficiaries
    ADD CONSTRAINT student_beneficiaries_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_beneficiaries
    ADD CONSTRAINT student_beneficiaries_grade_level_id_fkey
    FOREIGN KEY (grade_level_id) REFERENCES public.social_amelioration_settings(id);

ALTER TABLE ONLY public.solo_parent_beneficiaries
    ADD CONSTRAINT solo_parent_beneficiaries_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.solo_parent_beneficiaries
    ADD CONSTRAINT solo_parent_beneficiaries_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.social_amelioration_settings(id);

ALTER TABLE ONLY public.beneficiary_program_pivots
    ADD CONSTRAINT beneficiary_program_pivots_program_id_fkey
    FOREIGN KEY (program_id) REFERENCES public.government_programs(id) ON DELETE CASCADE;

-- Bridge table foreign keys
ALTER TABLE ONLY public.citizen_resident_mapping
    ADD CONSTRAINT citizen_resident_mapping_citizen_id_fkey
    FOREIGN KEY (citizen_id) REFERENCES public.citizens(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.citizen_resident_mapping
    ADD CONSTRAINT citizen_resident_mapping_resident_id_fkey
    FOREIGN KEY (resident_id) REFERENCES public.residents(id) ON DELETE CASCADE;

-- =============================================================================
-- END OF UNIFIED SCHEMA
-- =============================================================================
