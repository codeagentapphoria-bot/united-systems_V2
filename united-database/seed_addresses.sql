-- Insert municipalities from gis_municipality with active status
INSERT INTO public.municipalities (
    municipality_name,
    municipality_code,
    gis_code,
    region,
    province,
    setup_status
)
SELECT 
    name,
    gis_municipality_code,  -- Use gis code as municipality_code
    gis_municipality_code,
    'Region VIII (Eastern Visayas)',
    'Eastern Samar',
    'active'
FROM public.gis_municipality
ON CONFLICT (municipality_name) DO NOTHING;

-- Insert barangays from gis_barangay
INSERT INTO public.barangays (
    municipality_id,
    barangay_name,
    barangay_code,
    gis_code
)
SELECT 
    m.id,
    b.name,
    b.gis_barangay_code,
    b.gis_barangay_code
FROM public.gis_barangay b
JOIN public.gis_municipality gm ON b.gis_municipality_code = gm.gis_municipality_code
JOIN public.municipalities m ON m.municipality_code = gm.gis_municipality_code
ON CONFLICT (municipality_id, barangay_name) DO NOTHING;