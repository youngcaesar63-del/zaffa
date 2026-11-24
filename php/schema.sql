-- ==========================================================
-- زَفّة — مخطط قاعدة البيانات (MySQL 5.7+ / MariaDB 10.3+)
-- استورديه من phpMyAdmin بعد إنشاء قاعدة البيانات
-- ==========================================================

CREATE TABLE IF NOT EXISTS invites (
  id                CHAR(8)      NOT NULL PRIMARY KEY,
  reference_number  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  edit_key_hash     CHAR(64)     NOT NULL,           -- sha256 للمفتاح (لا يُخزَّن المفتاح نفسه)
  status            ENUM('draft','pending','active') NOT NULL DEFAULT 'draft',
  template          VARCHAR(20)  NOT NULL DEFAULT 'garden',
  data              JSON         NOT NULL,
  email             VARCHAR(190) DEFAULT NULL,
  addon             TINYINT(1)   NOT NULL DEFAULT 0,
  stripe_session_id VARCHAR(120) DEFAULT NULL,
  bank_txn          VARCHAR(60)  DEFAULT NULL,
  bank_sender       VARCHAR(60)  DEFAULT NULL,
  bank_method       VARCHAR(16)  DEFAULT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at           DATETIME     DEFAULT NULL,
  INDEX idx_email (email),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB AUTO_INCREMENT=1001 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rsvps (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invite_id  CHAR(8)      NOT NULL,
  name       VARCHAR(80)  NOT NULL,
  attending  TINYINT(1)   NOT NULL DEFAULT 1,
  guests     TINYINT      NOT NULL DEFAULT 1,
  note       VARCHAR(300) DEFAULT NULL,
  side       CHAR(1)      DEFAULT NULL,
  ip_hash    CHAR(32)     DEFAULT NULL,               -- للحد من السبام دون تخزين IP خام
  edit_token_hash CHAR(64) DEFAULT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invite (invite_id),
  FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wishes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invite_id  CHAR(8)      NOT NULL,
  name       VARCHAR(60)  NOT NULL,
  message    VARCHAR(300) NOT NULL,
  hidden     TINYINT(1)   NOT NULL DEFAULT 0,
  ip_hash    CHAR(32)     DEFAULT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invite (invite_id),
  FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- عدّاد المبيعات
CREATE TABLE IF NOT EXISTS counters (
  name VARCHAR(40) NOT NULL PRIMARY KEY,
  val  INT         NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO counters (name, val) VALUES ('sold', 0);
