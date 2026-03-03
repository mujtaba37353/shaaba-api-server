const axios = require('axios');
const config = require('../config/config');

const wc = axios.create({
  baseURL: `${config.wc.baseUrl}/wp-json/wc/v3`,
  auth: {
    username: config.wc.consumerKey,
    password: config.wc.consumerSecret,
  },
  timeout: 30000,
});

wc.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const msg = error.response?.data?.message || error.message;
    const status = error.response?.status || 500;
    const err = new Error(msg);
    err.statusCode = status;
    err.code = error.response?.data?.code || 'wc_error';
    throw err;
  }
);

module.exports = wc;
