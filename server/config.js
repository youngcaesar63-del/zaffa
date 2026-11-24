'use strict';
const path = require('path');

function env(k, def = '') {
  const v = process.env[k];
  return v === undefined || v === '' ? def : v;
}

const cfg = {
  port: parseInt(env('PORT', '3000'), 10),
  trustedProxyIps: env('TRUSTED_PROXY_IPS', '').split(',').map(x => x.trim().replace(/^::ffff:/, '')).filter(Boolean),
  adminAuthFile: path.resolve(env('ZAFFA_ADMIN_AUTH_FILE', path.join(env('DATA_DIR', path.join(__dirname, '..', 'data')), 'admin-auth.json'))),
  publicUrl: env('PUBLIC_URL', 'http://localhost:' + env('PORT', '3000')),

  stripeKey: env('STRIPE_SECRET_KEY', ''),
  stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
  get demoMode() { return !this.stripeKey; },
  allowDemoCheckout: env('ALLOW_DEMO_CHECKOUT', '') === 'true',

  price: {
    card: parseInt(env('PRICE_CARD', '300'), 10),
    addon: parseInt(env('PRICE_ADDON', '200'), 10),
    addonRegular: parseInt(env('PRICE_ADDON_REGULAR', '500'), 10),
    currency: env('CURRENCY', 'usd'),
  },

  sd: {
    account: env('SD_ACCOUNT', '1572914'),
    fawry: env('SD_FAWRY_ACCOUNT', '51665206'),
    ocash: env('SD_OCASH_ACCOUNT', '1029939'),
    name: env('SD_NAME', 'أحمد أزهري حسين أحمد'),
    whatsapp: env('SD_WHATSAPP', '249123452495'),
    price: parseInt(env('SD_PRICE', '2000000'), 10),
    addon: parseInt(env('SD_ADDON', '1000000'), 10),
    currency: 'sdg',
  },

  dataDir: path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data'))),
  rootDir: path.resolve(__dirname, '..'),
};

module.exports = cfg;
