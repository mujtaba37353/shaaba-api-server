const axios = require('axios');
const config = require('../config/config');

const wpApi = axios.create({
  baseURL: `${config.wc.baseUrl}/wp-json/wp/v2`,
  auth: {
    username: config.wc.consumerKey,
    password: config.wc.consumerSecret,
  },
  timeout: 30000,
});

wpApi.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const msg = error.response?.data?.message || error.message;
    const status = error.response?.status || 500;
    const err = new Error(msg);
    err.statusCode = status;
    err.code = error.response?.data?.code || 'wp_error';
    throw err;
  }
);

async function getUserByEmail(email) {
  try {
    const users = await wpApi.get('/users', {
      params: { search: email, per_page: 100, context: 'edit' },
    });
    return (users || []).find(
      (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
    ) || null;
  } catch (_) {
    return null;
  }
}

module.exports = { wpApi, getUserByEmail };
