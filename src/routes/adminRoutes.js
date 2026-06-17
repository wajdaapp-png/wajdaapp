// src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();

const authAdminController = require('../controllers/admin/authAdminController');
const dashboardAdminController = require('../controllers/admin/dashboardController'); 
const driverAdminController = require('../controllers/admin/driverAdminController');
const clientAdminController = require('../controllers/admin/clientAdminController');
const ordersAdminController = require('../controllers/admin/ordersAdminController');
const financeAdminController = require('../controllers/admin/financeAdminController');
const notificationAdminController = require('../controllers/admin/notificationAdminController');
const settingsAdminController = require('../controllers/admin/settingsAdminController');
const ticketAdminController = require('../controllers/admin/ticketAdminController');

// ✅ [التعديل 1]: استدعاء كلا الحارسين من الميدلواير المطور
const { adminAuthMiddleware, checkAdminPermission } = require('../middleware/adminAuthMiddleware');

// مسارات مفتوحة
router.get('/login', authAdminController.showLoginPage);
router.post('/login', authAdminController.processLogin);
router.get('/logout', authAdminController.logout);

// =========================================================================
// 🔐 مسارات مفحوصة بالصلاحيات والأدوار الإدارية (تم إصلاح تسلسل الحراس)
// =========================================================================

// ✅ يجب أن يمر الطلب أولاً بـ adminAuthMiddleware لفك الكوكي، ثم checkAdminPermission للتحقق من المصفوفتين
router.get('/dashboard', adminAuthMiddleware, checkAdminPermission('dashboard'), dashboardAdminController.showDashboard);

router.get('/drivers', adminAuthMiddleware, checkAdminPermission('drivers'), driverAdminController.getDriversPage);
router.post('/drivers/toggle-status/:id', adminAuthMiddleware, checkAdminPermission('drivers'), driverAdminController.toggleDriverStatus);
router.get('/drivers/edit/:id', adminAuthMiddleware, checkAdminPermission('drivers'), driverAdminController.getEditDriverPage);

router.get('/clients', adminAuthMiddleware, checkAdminPermission('clients'), clientAdminController.getClientsPage);
router.post('/clients/toggle-status/:id', adminAuthMiddleware, checkAdminPermission('clients'), clientAdminController.toggleClientStatus);

router.get('/orders', adminAuthMiddleware, checkAdminPermission('orders'), ordersAdminController.getOrdersPage);

router.get('/finance', adminAuthMiddleware, checkAdminPermission('finance'), financeAdminController.getFinancePage);
router.post('/finance/update-taxes', adminAuthMiddleware, checkAdminPermission('finance'), financeAdminController.updateTaxSettings);

router.get('/notifications', adminAuthMiddleware, checkAdminPermission('notifications'), notificationAdminController.getNotificationsPage);
router.post('/notifications/create', adminAuthMiddleware, checkAdminPermission('notifications'), notificationAdminController.createNotification);

router.get('/settings', adminAuthMiddleware, checkAdminPermission('settings'), settingsAdminController.getSettingsPage);
router.post('/settings/create-admin', adminAuthMiddleware, checkAdminPermission('settings'), settingsAdminController.createAdmin);
router.post('/settings/update-admin', adminAuthMiddleware, checkAdminPermission('settings'), settingsAdminController.updateAdminPermissions);

router.get('/tickets', adminAuthMiddleware, checkAdminPermission('tickets'), ticketAdminController.renderTicketsDashboard);

module.exports = router;