-- =========================================================
-- GS Shift Log 사용자 인증 데이터베이스
-- =========================================================


-- =========================================================
-- 직원 명단
-- =========================================================

CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  employee_name TEXT NOT NULL,

  role TEXT NOT NULL DEFAULT 'user'
    CHECK (
      role IN (
        'user',
        'leader',
        'super_admin'
      )
    ),

  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (
      is_active IN (0, 1)
    ),

  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 로그인 계정
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  employee_id TEXT PRIMARY KEY,

  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,

  must_change_password INTEGER NOT NULL DEFAULT 1
    CHECK (
      must_change_password IN (0, 1)
    ),

  failed_login_count INTEGER NOT NULL DEFAULT 0,

  locked_until TEXT,

  last_login_at TEXT,

  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (
    employee_id
  )
  REFERENCES employees (
    employee_id
  )
  ON DELETE CASCADE
);


-- =========================================================
-- 로그인 세션
-- =========================================================

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,

  employee_id TEXT NOT NULL,

  expires_at TEXT NOT NULL,

  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  last_used_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (
    employee_id
  )
  REFERENCES employees (
    employee_id
  )
  ON DELETE CASCADE
);


-- =========================================================
-- 회원 활동 기록
-- =========================================================

CREATE TABLE IF NOT EXISTS auth_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  employee_id TEXT,

  action TEXT NOT NULL,

  success INTEGER NOT NULL DEFAULT 0
    CHECK (
      success IN (0, 1)
    ),

  ip_address TEXT,

  user_agent TEXT,

  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP
);


-- =========================================================
-- 검색 인덱스
-- =========================================================

CREATE INDEX IF NOT EXISTS
idx_sessions_employee_id
ON sessions (
  employee_id
);


CREATE INDEX IF NOT EXISTS
idx_sessions_expires_at
ON sessions (
  expires_at
);


CREATE INDEX IF NOT EXISTS
idx_auth_logs_employee_id
ON auth_logs (
  employee_id
);


CREATE INDEX IF NOT EXISTS
idx_auth_logs_created_at
ON auth_logs (
  created_at
);