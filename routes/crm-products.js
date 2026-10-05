// routes/crm-products.js — CRM product list for the Clients dropdowns (ls_crm owns the table).
// Mounted at /api/products. Create/archive stay in the CRM app until its Settings page is merged.
const express = require('express');
const router = express.Router();
const { queryAll } = require('../db/schema');
const ah = require('../utils/asyncHandler');

router.get('/', ah(async (req, res) => {
  res.json(await queryAll("SELECT * FROM crm_products WHERE status != 'archived' ORDER BY name"));
}));

module.exports = router;
