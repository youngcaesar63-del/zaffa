-- نفّذ مرة واحدة على قواعد MySQL القديمة بعد أخذ نسخة احتياطية.
ALTER TABLE invites ADD COLUMN bank_method VARCHAR(16) DEFAULT NULL;
