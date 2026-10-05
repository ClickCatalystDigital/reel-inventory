// scripts/hashpasswords.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDB, queryAll, execute } = require('../db/schema');

(async () => {
  await initDB();
  const users = await queryAll('SELECT * FROM users');
  for (const user of users) {
    // Skip already hashed (bcrypt hashes start with $2b$)
    if (user.password.startsWith('$2b$')) {
      console.log(`${user.username} already hashed, skipping`);
      continue;
    }
    const hash = await bcrypt.hash(user.password, 10);
    await execute('UPDATE users SET password = ? WHERE id = ?', [hash, user.id]);
    console.log(`Hashed password for ${user.username}`);
  }
  console.log('Done');
  process.exit(0);
})();