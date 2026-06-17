const express = require('express');
const router = express.Router();
const userController = require('../../controllers/userController');

router.post('/update-live-location', userController.updateLiveLocation);

module.exports = router;