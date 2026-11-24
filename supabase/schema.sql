-- مخطط خاص بخادم زَفّة. لا يُطبّق تلقائيًا ولا يغيّر بيانات المعاينة.
-- يُنفّذ لاحقًا في مشروع جديد بعد مراجعة الربط وعمل نسخة احتياطية.
BEGIN;
CREATE SCHEMA IF NOT EXISTS zaffa_private;
REVOKE ALL ON SCHEMA zaffa_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zaffa_private.invites (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  reference_number bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zaffa_private.rsvps (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  invite_id text NOT NULL REFERENCES zaffa_private.invites(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zaffa_rsvps_invite_idx ON zaffa_private.rsvps(invite_id, created_at);
CREATE TABLE IF NOT EXISTS zaffa_private.wishes (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]{1,40}$'),
  invite_id text NOT NULL REFERENCES zaffa_private.invites(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zaffa_wishes_invite_idx ON zaffa_private.wishes(invite_id, created_at);
CREATE TABLE IF NOT EXISTS zaffa_private.settings (
  key text PRIMARY KEY,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
-- RLS حاجز إضافي: لا توجد سياسات وصول عامة أو من المتصفح.
ALTER TABLE zaffa_private.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaffa_private.rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaffa_private.wishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE zaffa_private.settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA zaffa_private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA zaffa_private FROM PUBLIC;
COMMIT;
