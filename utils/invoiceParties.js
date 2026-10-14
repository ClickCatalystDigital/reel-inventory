// Seller and buyer printed on Gelco tax invoices (copied from Tally's Sales_10023). Edit here when they change.
// ponytail: constants, not settings — move to Settings if they start changing often.
// The public demo prints made-up parties (see utils/brand.js).
const DEMO = process.env.DEMO_MODE === '1';

const seller = DEMO
  ? { name: 'Acme Components', lines: ['Plot 1, Demo Industrial Estate', 'Ahmedabad, Gujarat - 380001, India', '+91 00000 00000'], gstin: '24AAAAA0000A1Z5', state: 'Gujarat', stateCode: '24', email: 'sales@example.com',
      bank: { name: 'Demo Bank', account: '000000000000', branch: 'Main Branch & DEMO0000001' } }
  : { name: 'LS Technologies', lines: ['E-108/2, GIDC Electronic Estate, Sector 26,', 'Gandhinagar, Gujarat - 382028, India', '+91 88662 90430 / +91 94276 01438'], gstin: '24AAKFL3607J1ZB', state: 'Gujarat', stateCode: '24', email: 'sales@lstechnologies.in',
      bank: { name: 'ICICI Bank', account: '016505500822', branch: 'Sector-16 & ICIC0000165' } };

const buyer = DEMO
  ? { name: 'Partner Electronics Pvt Ltd', lines: ['12 Demo Road', 'Kalol, Gandhinagar'], gstin: '24BBBBB0000B1Z5', state: 'Gujarat', stateCode: '24' }
  : { name: 'GELCO Electronics Pvt Ltd', lines: ['142-Jalaram Ceramic', 'Khatraj - Kadi Road  Karoli', 'Taluka:Kalol,Dist:Gandhinagar'], gstin: '24AACCG5735H1ZQ', state: 'Gujarat', stateCode: '24' };

module.exports = { seller, buyer };
