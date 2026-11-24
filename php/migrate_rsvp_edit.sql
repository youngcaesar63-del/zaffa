-- نفّذ مرة واحدة على قواعد البيانات القائمة فقط قبل نشر التحديث.
ALTER TABLE rsvps ADD COLUMN edit_token_hash CHAR(64) DEFAULT NULL;
