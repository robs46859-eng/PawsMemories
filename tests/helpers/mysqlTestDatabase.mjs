export async function initializeLegacyUsersTable(pool) {
  await pool.query(`
    CREATE TABLE users (
      phone VARCHAR(190) PRIMARY KEY,
      email VARCHAR(320) NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      credits INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
