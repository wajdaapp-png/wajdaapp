// src/routes/driverRoutes.js
const express = require('express');
const router = express.Router();
const driverController = require('../../controllers/driverController');

// 🔒 1. بوابة الأمن المالي الاستباقي (GET) - لفحص محفظة السائق قبل فتح الرادار
router.get('/finance-status/:id', driverController.checkDriverFinanceStatus);

// 🔒 2. بوابة تحديث حالة الاتصال الفعلية (POST) - المربوطة بمفتاح السويتش في فلاتر
router.post('/toggle-online', driverController.updateOnlineStatus);

// 📦 3. باقي مسارات وجدول رحلات وعروض الكابتن المعتمدة بالنظام
router.post('/accept-shopping', driverController.acceptShoppingOrder); //
router.post('/submit-offer', driverController.submitDeliveryOffer); //
router.get('/trips/:driverId', driverController.getDriverTrips); //
router.post('/complete-trip', driverController.completeTrip); //
router.post('/update-status', driverController.updateTripStatus); 
router.get('/finance-details/:id', driverController.getDriverFinanceDetails);
router.get('/revenue-history/:id', driverController.getDriverRevenueHistory);
router.get('/commissions-history/:id', driverController.getDriverCommissionsHistory);
router.get('/notifications/:user_id', driverController.getActiveNotifications);
router.post('/notifications/mark-read', driverController.markNotificationAsRead);
router.post('/handover-cash', driverController.handOverCashToSender);

module.exports = router; //