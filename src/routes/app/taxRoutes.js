// src/routes/taxRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../../config/db'); 

router.get('/settings', async (req, res) => {
  try {
    const { userId } = req.query;
    let userPromo = 0;
    let activePromoCode = null;

    console.log(`\n=== 📡 [GET /settings Request with Promo Engine] ===`);
    console.log(`💡 Received userId: "${userId}" (Type: ${typeof userId})`);

    // 🎯 1. التحقق من وجود مستخدم لحساب الخصومات المخصصة له
    if (userId && userId !== 'undefined' && userId !== 'null') {
      const parsedUserId = parseInt(userId, 10);

      // جلب آخر كود برومو قام المستخدم بتفعيله في الـ Dashboard (إذا قمت بحفظه في جدول مستقل أو عمود بالـ users)
      // كمرحلة أولى آمنة: سنفحص جدول promo_codes مباشرة للبحث عن أكواد نشطة مخصصة لهذا المستخدم وتاريخها فعال
      const promoQuery = `
        SELECT discount_percentage, code 
        FROM promo_codes 
        WHERE is_active = true 
          AND expiry_date > NOW()
          AND (allowed_user_ids = '{}' OR $1 = ANY(allowed_user_ids))
          AND NOT (code = ANY(
            SELECT unnest(used_promo_codes) FROM users WHERE id = $1
          ))
        ORDER BY discount_percentage DESC 
        LIMIT 1;
      `;
      
      const promoResult = await db.query(promoQuery, [parsedUserId]);

      if (promoResult.rows.length > 0) {
        userPromo = Math.min(parseInt(promoResult.rows[0].discount_percentage || 0, 10), 100);
        activePromoCode = promoResult.rows[0].code;
        console.log(`🎯 Active Coupon Found [${activePromoCode}]: Discounting ${userPromo}%`);
      } else {
        // Fallback: إذا لم يجد كوداً نشطاً في الجدول، يقرأ القيمة الافتراضية لعمود المستخدم (منعاً لأي تضارب)
        const userResult = await db.query('SELECT COALESCE(promo, 0)::INT AS promo FROM users WHERE id = $1', [parsedUserId]);
        if (userResult.rows.length > 0) {
          userPromo = Math.min(userResult.rows[0].promo, 100);
          console.log(`ℹ️ Fallback to User Profile Promo Column: ${userPromo}%`);
        }
      }
    } else {
      console.log(`ℹ️ Public Settings request (No user_id provided or coming from Driver Radar)`);
    }

    // 2. جلب إعدادات النظام الحية من جدول system_settings
    const query = "SELECT key_name, key_value FROM system_settings";
    const result = await db.query(query);

    // الرد الافتراضي في حال كان جدول الإعدادات فارغاً لحماية التطبيق من الانهيار
    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        driver_tax_percentage: 5,
        client_fixed_fee: 50,
        min_delivery_price: 100,
        user_promo: userPromo,
        active_promo_code: activePromoCode
      });
    }

    // تحويل مصفوفة قاعدة البيانات إلى كائن JSON نظيف وسهل القراءة
    const settings = result.rows.reduce((acc, row) => {
      acc[row.key_name] = parseFloat(row.key_value);
      return acc;
    }, {});

    const driverTax = settings.driver_tax_percentage || 5;
    const baseFee = settings.client_fixed_fee || 50;
    const minPrice = settings.min_delivery_price || 100;

    console.log(`💰 Sending Financial Response back:`, {
      driver_tax_percentage: driverTax,
      client_fixed_fee: baseFee,
      min_delivery_price: minPrice,
      user_promo: userPromo,
      active_promo_code: activePromoCode
    });
    console.log(`=================================\n`);

    // 3. إرسال الاستجابة المالية الموحدة حياً إلى Flutter
    return res.status(200).json({
      success: true,
      driver_tax_percentage: driverTax,
      client_fixed_fee: baseFee,
      min_delivery_price: minPrice,
      user_promo: userPromo,
      active_promo_code: activePromoCode // قذف اسم الكود النشط لتأكيد تفعيله بالواجهة
    });

  } catch (error) {
    console.error('❌ Error fetching all system settings with Promo Logic:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});
module.exports = router;