// src/routes/taxRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../../config/db'); 

router.get('/settings', async (req, res) => {
  try {
    const { userId } = req.query;
    let userPromo = 0;

    console.log(`\n=== 📡 [GET /settings Request] ===`);
    console.log(`💡 Received userId: "${userId}" (Type: ${typeof userId})`);

    // إذا كان الطلب قادماً من الزبون ومصحوباً بـ ID، نتحقق من البرومو الخاص به
    if (userId && userId !== 'undefined' && userId !== 'null') {
      const parsedUserId = parseInt(userId, 10);
      const userResult = await db.query('SELECT promo FROM users WHERE id = $1', [parsedUserId]);

      if (userResult.rows.length > 0) {
        const rawPromo = userResult.rows[0].promo; 
        userPromo = Math.min(parseInt(rawPromo || 0, 10), 100);
        console.log(`🎯 User Promo Processed: ${userPromo}%`);
      }
    } else {
      console.log(`ℹ️ Public Settings request (No user_id provided or coming from Driver Radar)`);
    }

    // جلب إعدادات النظام الحية
    const query = "SELECT key_name, key_value FROM system_settings";
    const result = await db.query(query);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        driver_tax_percentage: 5,
        client_fixed_fee: 50,
        min_delivery_price: 100,
        user_promo: userPromo 
      });
    }

    const settings = result.rows.reduce((acc, row) => {
      acc[row.key_name] = parseFloat(row.key_value);
      return acc;
    }, {});

    console.log(`💰 Sending Financial Response back:`, {
      driver_tax_percentage: settings.driver_tax_percentage || 5,
      client_fixed_fee: settings.client_fixed_fee || 50,
      min_delivery_price: settings.min_delivery_price || 100,
      user_promo: userPromo
    });
    console.log(`=================================\n`);

    return res.status(200).json({
      success: true,
      driver_tax_percentage: settings.driver_tax_percentage || 5,
      client_fixed_fee: settings.client_fixed_fee || 50,
      min_delivery_price: settings.min_delivery_price || 100,
      user_promo: userPromo 
    });

  } catch (error) {
    console.error('❌ Error fetching all system settings:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});
module.exports = router;