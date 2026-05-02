-- HoneyBee-Enhanced core schema (MySQL 8+)

CREATE TABLE IF NOT EXISTS organizations (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(64)  NOT NULL UNIQUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id        BIGINT NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    role          ENUM('admin','operator','viewer') NOT NULL DEFAULT 'viewer',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_org_email (org_id, email),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nodes (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id          BIGINT NOT NULL,
    name            VARCHAR(255) NOT NULL,
    token_hash      VARCHAR(255) NOT NULL,
    os              VARCHAR(64)  NOT NULL DEFAULT '',
    arch            VARCHAR(32)  NOT NULL DEFAULT '',
    hostname        VARCHAR(255) NOT NULL DEFAULT '',
    status          ENUM('offline','online','deploying','failed') NOT NULL DEFAULT 'offline',
    last_heartbeat  TIMESTAMP NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP NULL,
    INDEX idx_nodes_org (org_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS deployments (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id          BIGINT NOT NULL,
    node_id         BIGINT NOT NULL,
    pot_id          VARCHAR(128) NOT NULL,
    honeypot_type   VARCHAR(64)  NOT NULL,
    config          JSON NOT NULL,
    status          ENUM('pending','installing','running','stopped','failed','removing','removed') NOT NULL DEFAULT 'pending',
    status_message  VARCHAR(1024) NOT NULL DEFAULT '',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_deploy_node_pot (node_id, pot_id),
    INDEX idx_deploy_org (org_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id      BIGINT NOT NULL,
    node_id     BIGINT NOT NULL,
    deploy_id   BIGINT NULL,
    command     VARCHAR(64)  NOT NULL,
    payload     JSON NOT NULL,
    status      ENUM('pending','sent','completed','failed') NOT NULL DEFAULT 'pending',
    result      TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tasks_node_status (node_id, status),
    INDEX idx_tasks_org (org_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (deploy_id) REFERENCES deployments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id          BIGINT NOT NULL,
    node_id         BIGINT NOT NULL,
    deploy_id       BIGINT NULL,
    pot_id          VARCHAR(128) NOT NULL,
    honeypot_type   VARCHAR(64)  NOT NULL,
    event_type      VARCHAR(128) NOT NULL,
    source_ip       VARCHAR(64)  NOT NULL DEFAULT '',
    source_port     INT NOT NULL DEFAULT 0,
    dest_port       INT NOT NULL DEFAULT 0,
    data            JSON NOT NULL,
    event_time      TIMESTAMP(6) NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_events_org_time (org_id, event_time),
    INDEX idx_events_type     (event_type),
    INDEX idx_events_ip       (source_ip),
    INDEX idx_events_pot      (pot_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pot_logs (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id      BIGINT NOT NULL,
    node_id     BIGINT NOT NULL,
    pot_id      VARCHAR(128) NOT NULL,
    pot_type    VARCHAR(64)  NOT NULL,
    log_type    VARCHAR(64)  NOT NULL,
    data        JSON NOT NULL,
    logged_at   TIMESTAMP(6) NOT NULL,
    INDEX idx_potlogs_pot_time (pot_id, logged_at),
    INDEX idx_potlogs_org_time (org_id, logged_at),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id          BIGINT NOT NULL,
    node_id         BIGINT NOT NULL,
    deploy_id       BIGINT NULL,
    pot_id          VARCHAR(128) NOT NULL,
    session_id      VARCHAR(128) NOT NULL,
    src_ip          VARCHAR(64)  NOT NULL,
    src_port        INT NOT NULL DEFAULT 0,
    dst_port        INT NOT NULL DEFAULT 0,
    started_at      TIMESTAMP(6) NOT NULL,
    ended_at        TIMESTAMP(6) NULL,
    duration_secs   BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_sessions_sid (session_id),
    INDEX idx_sessions_org (org_id),
    INDEX idx_sessions_pot (pot_id),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS session_data (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id  BIGINT NOT NULL,
    sequence    BIGINT NOT NULL,
    raw_data    LONGBLOB NOT NULL,
    captured_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_sd_session_seq (session_id, sequence),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    org_id      BIGINT NOT NULL,
    user_id     BIGINT NULL,
    action      VARCHAR(64)  NOT NULL,
    resource    VARCHAR(64)  NOT NULL,
    resource_id VARCHAR(128) NULL,
    details     TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_org_time (org_id, created_at),
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- idempotent migrations
ALTER TABLE pot_logs ADD COLUMN IF NOT EXISTS deployment_id BIGINT NULL AFTER node_id;
ALTER TABLE pot_logs ADD INDEX IF NOT EXISTS idx_potlogs_dep (deployment_id);
