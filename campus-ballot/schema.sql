CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash CHAR(161) NOT NULL,
    role VARCHAR(5) NOT NULL CHECK (role IN ('admin', 'voter'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    expires_at CHAR(24) NOT NULL,
    INDEX sessions_expiry (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS elections (
    id CHAR(36) PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL,
    status VARCHAR(6) NOT NULL CHECK (status IN ('draft', 'open', 'closed')),
    created_at CHAR(24) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS candidates (
    election_id CHAR(36) NOT NULL,
    id CHAR(36) NOT NULL,
    name VARCHAR(80) NOT NULL,
    PRIMARY KEY (election_id, id),
    UNIQUE (election_id, name),
    FOREIGN KEY (election_id) REFERENCES elections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS voter_participation (
    election_id CHAR(36) NOT NULL,
    voter_id CHAR(36) NOT NULL,
    PRIMARY KEY (election_id, voter_id),
    FOREIGN KEY (election_id) REFERENCES elections(id),
    FOREIGN KEY (voter_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS ballots (
    id CHAR(36) PRIMARY KEY,
    election_id CHAR(36) NOT NULL,
    candidate_id CHAR(36) NOT NULL,
    INDEX ballots_candidate (election_id, candidate_id),
    FOREIGN KEY (election_id, candidate_id) REFERENCES candidates(election_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE OR REPLACE VIEW election_results AS
SELECT c.election_id, c.id AS candidate_id, c.name, COUNT(b.id) AS votes
FROM candidates c
JOIN elections e ON e.id = c.election_id AND e.status = 'closed'
LEFT JOIN ballots b ON b.election_id = c.election_id AND b.candidate_id = c.id
GROUP BY c.election_id, c.id, c.name;
