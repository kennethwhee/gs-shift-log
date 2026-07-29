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

-- =========================================================
-- 브랜드 설정
--
-- 항상 id = 1 한 행만 사용
-- 이미지 파일은 R2에 저장하고,
-- DB에는 버전값과 표시 설정만 저장
-- =========================================================

CREATE TABLE IF NOT EXISTS brand_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),

  company_name TEXT NOT NULL DEFAULT 'GS 포천그린에너지',

  program_name TEXT NOT NULL DEFAULT 'GS Shift Log',

  program_subtitle TEXT NOT NULL DEFAULT '교대근무 업무일지 시스템',

  logo_content_type TEXT NOT NULL DEFAULT '',

  logo_version TEXT NOT NULL DEFAULT '',

  background_content_type TEXT NOT NULL DEFAULT '',

  background_version TEXT NOT NULL DEFAULT '',

  background_position_x INTEGER NOT NULL DEFAULT 50,

  background_position_y INTEGER NOT NULL DEFAULT 50,

  background_overlay INTEGER NOT NULL DEFAULT 30,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


INSERT OR IGNORE INTO brand_settings (
  id,
  company_name,
  program_name,
  program_subtitle,
  logo_content_type,
  logo_version,
  background_content_type,
  background_version,
  background_position_x,
  background_position_y,
  background_overlay,
  updated_at
)
VALUES (
  1,
  'GS 포천그린에너지',
  'GS Shift Log',
  '교대근무 업무일지 시스템',
  '',
  '',
  '',
  '',
  50,
  50,
  30,
  CURRENT_TIMESTAMP
);