const axios = require('axios');
const config = require('../config/config');

const shaabaApi = axios.create({
  baseURL: `${config.wc.baseUrl}/wp-json/shaaba/v1`,
  auth: {
    username: config.wc.consumerKey,
    password: config.wc.consumerSecret,
  },
  timeout: 30000,
});

shaabaApi.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const msg = error.response?.data?.message || error.message;
    const status = error.response?.status || 500;
    const err = new Error(msg);
    err.statusCode = status;
    err.code = error.response?.data?.code || 'shaaba_api_error';
    throw err;
  }
);

module.exports = shaabaApi;
