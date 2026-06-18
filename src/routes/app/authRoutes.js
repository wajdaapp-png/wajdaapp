// src/routes/authRoutes.js
const express = require('express');
const { registerUser } = require('../../controllers/authController');

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', require('../../controllers/authController').loginUser);

module.exports = router;