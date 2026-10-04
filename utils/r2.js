const { S3Client } = require('@aws-sdk/client-s3');

// Shared Cloudflare R2 client (routes/gelco-docs.js uploads, routes/settings.js storage usage).
module.exports = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
