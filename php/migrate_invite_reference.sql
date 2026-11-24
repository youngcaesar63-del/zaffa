-- خذ نسخة احتياطية. نفّذ مرة واحدة فقط على قاعدة قائمة لا تحتوي العمود.
-- ستُرقّم الدعوات القديمة تلقائيًا؛ راجع الأرقام بعد الترحيل.
ALTER TABLE invites ADD COLUMN reference_number BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE, AUTO_INCREMENT = 1001;
