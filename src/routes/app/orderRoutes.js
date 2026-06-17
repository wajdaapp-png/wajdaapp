// src/routes/orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../../controllers/orderController');

// الرابط النهائي سيكون: /api/orders/client/:user_id
router.get('/client/:user_id', orderController.getClientOrders);
router.post('/create-package', orderController.createPackageOrder);
router.post('/create-shopping', orderController.createShoppingOrder);
router.get('/radar', orderController.getRadarOrders);
router.delete('/cancel/:order_id', orderController.cancelOrder);

module.exports = router;