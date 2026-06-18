const express = require('express');
const router = express.Router();
const clientController = require('../../controllers/clientController');
const { uploadAvatar } = require('../../middleware/uploadMiddleware');

router.get('/package-offers/:package_id', clientController.getPackageOffers);
router.get('/package-status/:package_id', clientController.getPackageStatus);
router.post('/package-offers/accept', clientController.acceptPackageOffer);
router.post('/rate-driver', clientController.rateDriver);
router.get('/history/:user_id', clientController.getClientHistoryOrders);
router.put('/update-settings', uploadAvatar, clientController.updateProfileSettings);
router.post('/skip-rating', clientController.skipDriverRating);

router.post('/change-password', clientController.changePassword);
router.get('/devices/:user_id', clientController.getConnectedDevices);
router.post('/devices/disconnect', clientController.disconnectDevice);
router.delete('/delete-account', clientController.deleteAccount);

router.get('/system-settings', clientController.getSystemSettings );
// =========================================================================
// 🔔 مركز التنبيهات والإشعارات الفورية الخاص بالزبائن (تم التطهير والتعديل)
// =========================================================================
// ✅ تم نزع /clients لأن البادئة تأتي تلقائياً من الموجه الرئيسي للمشروع
router.get('/notifications/:user_id', clientController.getClientNotifications);
router.post('/notifications/mark-read', clientController.markClientNotificationAsRead);

module.exports = router;