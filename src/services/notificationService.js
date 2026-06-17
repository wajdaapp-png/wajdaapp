// src/services/notificationService.js

const { getMessaging } = require('firebase-admin/messaging');

/**
 * 🚀 الخدمة المركزية الموحدة لإرسال الإشعارات الفورية
 * @param {string} fcmToken - توكن جهاز المستخدم المستهدف
 * @param {string} title - عنوان الإشعار المشوق
 * @param {string} body - نص الإشعار التفصيلي
 * @param {Object} dataPayload - البيانات الخلفية الموجهة لشاشات فلاتر حياً
 */
const sendPushNotification = async (fcmToken, title, body, dataPayload = {}) => {
  // حماية صارمة: إذا كان التوكن فارغاً أو وهمياً، نلغي العملية صامتاً لتلافي كراش السيرفر
  if (!fcmToken || fcmToken === '' || fcmToken.startsWith('unknown')) {
    console.log(`⚠️ [Notification Skipped] لم يتم إرسال الإشعار لعدم توفر FCM Token صحيح.`);
    return false;
  }

  // بناء هيكل الرسالة الموحد المتوافق مع أندرويد وآيفون
  const message = {
    notification: {
      title: title,
      body: body,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      ...dataPayload,
    },
    token: fcmToken.trim(),
  };

  try {
    // 🎯 الاستدعاء المباشر المستقر من النواة المهيأة مسبقاً في الـ app.js
    const response = await getMessaging().send(message);
    console.log(`🔔 [Notification Sent Successfully] تم قذف الإشعار بنجاح! ID: ${response}`);
    return true;
  } catch (error) {
    console.error('❌ [Firebase Send Error] فشل إرسال الإشعار الفوري للتوكن المستهدف:', error.message);
    return false;
  }
};

module.exports = {
  sendPushNotification
};