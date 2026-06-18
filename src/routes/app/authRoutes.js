// src/routes/authRoutes.js
const express = require('express');
const { registerUser } = require('../../controllers/authController');
const { sendOtp, verifyOtp } = require('../../controllers/otpController');
const router = express.Router();

router.post('/register', registerUser);
router.post('/login', require('../../controllers/authController').loginUser);
router.post('/otp/send', sendOtp);
router.post('/otp/verify', verifyOtp);

module.exports = router;