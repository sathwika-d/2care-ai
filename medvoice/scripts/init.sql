-- MedVoice seed data

-- Doctors
INSERT INTO doctors (id, name, specialty, languages, available_days, slot_duration_minutes) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Dr. Priya Sharma', 'General Physician', '["en","hi"]', '["monday","tuesday","wednesday","thursday","friday"]', 30),
  ('22222222-2222-2222-2222-222222222222', 'Dr. Rajan Nair', 'Cardiologist', '["en","ta","hi"]', '["monday","wednesday","friday"]', 45),
  ('33333333-3333-3333-3333-333333333333', 'Dr. Meera Iyer', 'Dermatologist', '["en","ta"]', '["tuesday","thursday","saturday"]', 30),
  ('44444444-4444-4444-4444-444444444444', 'Dr. Arjun Patel', 'Orthopedic', '["en","hi","gu"]', '["monday","tuesday","thursday","friday"]', 45),
  ('55555555-5555-5555-5555-555555555555', 'Dr. Ananya Das', 'Pediatrician', '["en","hi","bn"]', '["monday","tuesday","wednesday","thursday","friday","saturday"]', 20)
ON CONFLICT DO NOTHING;

-- Availability slots (next 7 days)
INSERT INTO availability_slots (id, doctor_id, start_time, end_time, is_booked)
SELECT
  gen_random_uuid(),
  doc_id,
  slot_time,
  slot_time + INTERVAL '30 minutes',
  false
FROM (
  SELECT
    d.id as doc_id,
    generate_series(
      NOW()::date + INTERVAL '1 day' + INTERVAL '9 hours',
      NOW()::date + INTERVAL '7 days' + INTERVAL '17 hours',
      INTERVAL '30 minutes'
    ) as slot_time,
    d.name
  FROM doctors d
  WHERE EXTRACT(dow FROM (NOW()::date + INTERVAL '1 day')) NOT IN (0, 6)
) slots
WHERE EXTRACT(hour FROM slot_time) BETWEEN 9 AND 17
  AND EXTRACT(minute FROM slot_time) IN (0, 30)
ON CONFLICT DO NOTHING;

-- Demo patients
INSERT INTO patients (id, name, phone, email, preferred_language, medical_conditions) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Raj Kumar', '+91-9876543210', 'raj@example.com', 'hi', '["hypertension","diabetes"]'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Pritha Suresh', '+91-9876543211', 'pritha@example.com', 'ta', '[]'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Aditya Menon', '+91-9876543212', 'aditya@example.com', 'en', '["asthma"]')
ON CONFLICT DO NOTHING;
