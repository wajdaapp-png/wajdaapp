// src/routes/homeRoutes.js

const express = require('express');
const router = express.Router();
const homeController = require('../controllers/home/homeController');

router.get('/', homeController.renderIndex);
router.get('/about', homeController.renderAbout);
router.get('/privacy', homeController.renderPrivacy);
router.get('/terms', homeController.renderTerms);
router.get('/contact', homeController.renderContact);
router.post('/contact/ticket', homeController.createSupportTicket);

module.exports = router;    