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

async function getCities(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 100));

    const response = await wpApi.get('/city', {
      params: { page, per_page, _fields: 'id,title,meta,status' },
    });

    const cities = (response.data || []).map((c) => ({
      id: c.id,
      title: c.title?.rendered || c.title || '',
      lat: c.meta?.lat || null,
      lng: c.meta?.lng || null,
      meta: c.meta || {},
    }));

    const total = parseInt(response.headers['x-wp-total'], 10) || cities.length;
    const totalPages = parseInt(response.headers['x-wp-totalpages'], 10) || 1;

    return res.json({
      cities,
      pagination: { page, per_page, total, total_pages: totalPages },
    });
  } catch (error) {
    const err = new Error(error.response?.data?.message || error.message);
    err.statusCode = error.response?.status || 500;
    next(err);
  }
}

async function getBranches(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const per_page = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 100));

    const params = { page, per_page, _fields: 'id,title,meta,status' };
    if (req.query.city_id) params.meta_key = '_shaaba_branch_city_id';
    if (req.query.city_id) params.meta_value = String(req.query.city_id);

    const response = await wpApi.get('/branch', { params });

    let branches = (response.data || []).map((b) => ({
      id: b.id,
      title: b.title?.rendered || b.title || '',
      city_id: b.meta?.city_id ? parseInt(b.meta.city_id, 10) : null,
      meta: b.meta || {},
    }));

    if (req.query.city_id && !params.meta_key) {
      const cityId = parseInt(req.query.city_id, 10);
      branches = branches.filter((b) => b.city_id === cityId);
    }

    const total = parseInt(response.headers['x-wp-total'], 10) || branches.length;
    const totalPages = parseInt(response.headers['x-wp-totalpages'], 10) || 1;

    return res.json({
      branches,
      pagination: { page, per_page, total, total_pages: totalPages },
    });
  } catch (error) {
    const err = new Error(error.response?.data?.message || error.message);
    err.statusCode = error.response?.status || 500;
    next(err);
  }
}

async function getBranch(req, res, next) {
  try {
    const { id } = req.params;

    const response = await wpApi.get(`/branch/${id}`);
    const b = response.data;

    const branch = {
      id: b.id,
      title: b.title?.rendered || b.title || '',
      city_id: b.meta?.city_id ? parseInt(b.meta.city_id, 10) : null,
      meta: b.meta || {},
    };

    return res.json({ branch });
  } catch (error) {
    const err = new Error(error.response?.data?.message || error.message);
    err.statusCode = error.response?.status || 500;
    next(err);
  }
}

module.exports = { getCities, getBranches, getBranch };
