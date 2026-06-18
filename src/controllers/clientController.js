// src/controllers/clientController.js

const db = require('../config/db');
const bcrypt = require('bcrypt');

// =========================================================================
// 1️⃣ جلب عروض الأسعار المرتبطة بطلب معين
// =========================================================================
const getPackageOffers = async (req, res) => {
  const packageId = parseInt(req.params.package_id, 10);
  const orderType = req.query.order_type || 'package'; // 'package' أو 'shopping'

  if (!packageId) {
    return res.status(400).json({ success: false, message: 'معرف الطلب مفقود.' });
  }

  try {
    // 1. جلب العروض المستلمة حالياً للطلب مع تفاصيل الكباتن
    const offersQuery = `
      SELECT 
        o.id AS offer_id,
        o.offer_price,
        d.full_name AS driver_name,
        d.phone_number AS driver_phone,
        d.avatar_url AS driver_avatar,
        COALESCE(d.rating, 5.0) AS driver_rating,
        o.driver_id
      FROM delivery_offers o
      JOIN users d ON o.driver_id = d.id
      WHERE o.order_id = $1 AND o.order_type = $2
      ORDER BY o.created_at ASC;
    `;

    // 2. جلب إحداثيات موقع الطلب الحالي ونسبة خصم برومو الزبون حياً
    const orderCoordsQuery = `
      SELECT 
        o.id,
        u.latitude, 
        u.longitude,
        COALESCE(u.promo, 0)::INT AS client_promo
      FROM core_orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = $1;
    `;

    const [offersResult, coordsResult] = await Promise.all([
      db.query(offersQuery, [packageId, orderType]),
      db.query(orderCoordsQuery, [packageId])
    ]);

    if (coordsResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود بالنظام.' });
    }

    const orderData = coordsResult.rows[0];
    const clientLat = parseFloat(orderData.latitude);
    const clientLng = parseFloat(orderData.longitude);
    
    let nearbyDrivers = [];

    // 3. حساب المسافات الجغرافية لجلب الكباتن المحيطين (2 كلم) فقط إذا كانت إحداثيات الطلب مسجلة
    if (clientLat && clientLng) {
      const driversGeoQuery = `
        SELECT 
          id,
          avatar_url,
          (6371 * acos(
            cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) + 
            sin(radians($1)) * sin(radians(latitude))
          )) AS distance_km
        FROM users
        WHERE is_online = true 
          AND default_role = 'both'
          AND latitude IS NOT NULL 
          AND longitude IS NOT NULL
        ORDER BY distance_km ASC;
      `;

      const driversResult = await db.query(driversGeoQuery, [clientLat, clientLng]);
      
      // 🎯 التحديث السحري: فلترة وبناء كائن السائقين مع ضمان تمرير حقل avatar_url بشكل سليم ونظيف
      nearbyDrivers = driversResult.rows
        .filter(driver => parseFloat(driver.distance_km) <= 2.0)
        .map(driver => ({
          id: driver.id,
          // تأمين تمرير الرابط كما هو مخزن، أو إرسال نص فارغ في حال عدم وجود صورة شخصية للسائق
          avatar_url: driver.avatar_url ? driver.avatar_url.toString().trim() : '',
          distance_km: parseFloat(driver.distance_km)
        }));
    }

    console.log(`📡 [Offers Radar Central] طلب رقم (${packageId}): جلب ${offersResult.rows.length} عرض، ورصد ${nearbyDrivers.length} كابتن محيط بالرادار.`);
    console.log(`🖼️ روابط صور الكباتن المحيطين في الرادار:`, nearbyDrivers.map(d => d.avatar_url));

    return res.status(200).json({
      success: true,
      offers: offersResult.rows,
      nearby_drivers: nearbyDrivers, // دمج قائمة الكباتن المحيطين بالرد
      client_promo: orderData.client_promo
    });

  } catch (error) {
    console.error('❌ Error fetching package offers & radar geo-drivers:', error);
    return res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء معالجة الرادار الجغرافي والعروض.' });
  }
};

module.exports = {
  // تذكر تصدير الدالة مع بقية دوال الملف لديك
  getPackageOffers
};
// =========================================================================
// 2️⃣ جلب حالة الطلب الجارية للتتبع الحي (نسخة مصححة ومؤمنة مالياً لـ Shopping 🧭⚡)
// =========================================================================
const getPackageStatus = async (req, res) => {
  const rawId = req.params.package_id || req.params.id;
  const order_id = parseInt(rawId, 10);

  console.log(`📡 [API Request] تم استقبال طلب تتبع للمعرف الصافي: ${order_id}`);

  if (!order_id || isNaN(order_id) || order_id === 0) {
    return res.status(400).json({ success: false, message: 'معرف الطلب غير صحيح أو مفقود.' });
  }

  try {
    const mainQuery = `
      SELECT 
        o.status,
        o.driver_id,
        o.order_type, 
        u.full_name AS driver_name,
        u.phone_number AS driver_phone,
        COALESCE(u.avatar_url, '') AS driver_avatar,
        
        -- 🎯 التعديل السحري الأول: جلب السعر ديناميكياً بناءً على نوع الطلب لمنع قيمة 0.0 في الـ Shopping
        CASE 
          WHEN o.order_type = 'shopping' THEN COALESCE(s.estimated_budget, 0.0)
          ELSE COALESCE(offers.offer_price, 0.0)
        END AS final_trip_price,

        COALESCE(p.package_name, CONCAT('شراء من: ', s.store_name)) AS package_name,
        COALESCE(p.extra_details, s.shopping_list) AS pickup_city, 
        o.pickup_address,
        o.dropoff_address,
        COALESCE(u2.promo, 0)::INT AS client_promo

      FROM core_orders o
      LEFT JOIN delivery_offers offers ON o.id = offers.order_id AND offers.status = 'accepted' 
      LEFT JOIN users u ON o.driver_id = u.id 
      JOIN users u2 ON o.user_id = u2.id    
      LEFT JOIN package_order_details p ON o.id = p.order_id AND o.order_type = 'package'
      LEFT JOIN shopping_order_details s ON o.id = s.order_id AND o.order_type = 'shopping'
      WHERE o.id = $1
      LIMIT 1;
    `;

    const result = await db.query(mainQuery, [order_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود في النظام.' });
    }

    const tripData = result.rows[0];

    res.status(200).json({ 
        success: true, 
        status: tripData.status,
        order_type: tripData.order_type, // قذف نوع الطلب ليتأكد منه فلاتر حياً
        driver_id: tripData.driver_id, 
        driver_name: tripData.driver_name || (tripData.driver_id ? 'كابتن واجدة' : 'جاري تعيين الكابتن...'),
        driver_phone: tripData.driver_phone || '',
        driver_avatar: tripData.driver_avatar || '',
        
        // 🎯 تمرير الحقل الموحد والآمن الجديد هنا
        price: parseFloat(tripData.final_trip_price) || 0.0,
        
        package_name: tripData.package_name,
        pickup_city: tripData.pickup_city,
        dropoff_city: tripData.order_type === 'shopping' ? 'موقعك الحالي المقيد' : tripData.dropoff_address,
        client_promo: tripData.client_promo
    });

  } catch (error) {
    console.error('❌ Error inside getPackageStatus:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// =========================================================================
// 3️⃣ قبول عرض السعر الخاص بكابتن وتأمين قفل الرحلة (نسخة مكافحة الثغرات بـ DELETE 🚀⚡)
// =========================================================================
const acceptPackageOffer = async (req, res) => {
  const { package_id, driver_id, offer_id } = req.body;

  if (!package_id || !driver_id || !offer_id) {
    return res.status(400).json({ success: false, message: 'كافة المعطيات مطلوبة لتأكيد الرحلة.' });
  }

  try {
    await db.query('BEGIN');

    // 🛡️ صمام أمان مزدوج: التأكد أولاً من أن السائق لم يتم قبوله في طلب آخر منذ أجزاء من الثانية
    const busyCheck = await db.query(
      `SELECT id FROM core_orders 
       WHERE driver_id = $1 
         AND status IN ('active', 'picked_up', 'delivered_awaiting_cash') 
       LIMIT 1;`,
      [driver_id]
    );

    if (busyCheck.rows.length > 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: 'عذراً، هذا الكابتن أصبح مشغولاً الآن برحلة أخرى تم قبولها مؤخراً.' 
      });
    }

    // 1. تحديث الطلب الحالي ليصبح نشطاً مع هذا السائق
    const updateOrderQuery = `
      UPDATE core_orders 
      SET status = 'active', driver_id = $1
      WHERE id = $2 AND status = 'pending_offers'
      RETURNING id, user_id;
    `;
    const orderResult = await db.query(updateOrderQuery, [driver_id, package_id]);

    if (orderResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'عذراً، لم نتمكن من قبول العرض، قد يكون الطلب تم قبوله من سائق آخر أو إلغائه.' 
      });
    }

    // 2. تحديث حالة العرض الحالي المقبول إلى completed (أو إبقاؤه accepted حسب نظام الفواتير لديك)
    await db.query(`UPDATE delivery_offers SET status = 'accepted' WHERE id = $1`, [offer_id]);

    // 🎯 3. جلب أرقام الطلبات الأخرى التي سيُحذف عرض هذا السائق منها (لتحديث شاشات زبائنها حياً عبر السوكيت)
    const pendingOffersQuery = `
      SELECT DISTINCT order_id FROM delivery_offers 
      WHERE driver_id = $1 AND status = 'pending' AND order_id != $2;
    `;
    const affectedOrdersResult = await db.query(pendingOffersQuery, [driver_id, package_id]);
    const affectedOrderIds = affectedOrdersResult.rows.map(row => parseInt(row.order_id, 10));

    // 🎯 4. الحذف النهائي والصارم (DELETE) لكل عروض السائق المعلقة الأخرى في قاعدة البيانات لتفادي التخزين الميت
    await db.query(
      `DELETE FROM delivery_offers WHERE driver_id = $1 AND status = 'pending' AND order_id != $2;`,
      [driver_id, package_id]
    );

    await db.query('COMMIT');
    console.log(`🗑️ [DELETE & Clean Verified] تم قفل الطلب #${package_id}. وسحق كافة عروض الكابتن #${driver_id} المعلقة الأخرى نهائياً من قاعدة البيانات.`);

    // 📡 5. قنوات البث الحي والتزامن المطلق (Socket.io)
    if (req.io) {
      // أ. إخطار السائق المقبول فوراً ليعلم بقفل العقد والتحرك للاستلام
      req.io.emit(`offer_accepted_by_client_${driver_id}`, {
        order_id: package_id,
        status: 'active',
        message: '🎉 مبارك يا كابتن! وافق الزبون على عرضك المالي، انطلق الآن للاستلام.'
      });

      // ب. تنظيف رادار بقية السائقين لإخفاء هذا الطلب المقفل نهائياً
      req.io.emit('remove_order_from_radar', { order_id: package_id });

      // جـ. تنظيف شاشات الزبائن الآخرين حياً ومسح كارد عرض هذا السائق فوراً من واجهاتهم
      affectedOrderIds.forEach(orderId => {
        req.io.emit(`remove_driver_offer_from_client_screen_${orderId}`, { 
          driver_id: driver_id 
        });
      });
      
      // د. إرسال حدث جدار الحماية لتحديث رادار هذا السائق محلياً في فلاتر وقفل أزراره
      req.io.emit(`driver_radar_sync_forced_${driver_id}`, { has_active_trip: true });
    }

    res.status(200).json({ success: true, message: '🚀 تم قبول العرض بنجاح! تم قفل الرحلة وجاري توجيه الكابتن إليك.' });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('❌ Accept Offer Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء تأكيد العرض المالي.' });
  }
};

// =========================================================================
// 4️⃣ تقييم السائق وإغلاق الطلب نهائياً (محدثة بالبث اللحظي للوحة التحكم)
// =========================================================================
const rateDriver = async (req, res) => {
  const { driver_id, rating, order_id } = req.body;

  if (!driver_id || !rating || !order_id) {
    return res.status(400).json({ success: false, message: 'معطيات التقييم ناقصة.' });
  }

  try {
    await db.query('BEGIN');

    const updateRatingQuery = `
      UPDATE users 
      SET rating = CASE 
        WHEN rating IS NULL OR rating = 0 THEN $1 
        ELSE (rating + $1) / 2 
      END
      WHERE id = $2;
    `;
    await db.query(updateRatingQuery, [rating, driver_id]);
    
    // تحويل الحالة إلى reviewed
    await db.query(`UPDATE core_orders SET status = 'reviewed' WHERE id = $1`, [order_id]);

    await db.query('COMMIT');
    console.log(`⭐ [Driver Rated] تم تقييم السائق رقم (${driver_id}) بـ (${rating}) نجوم للطلب رقم (${order_id})`);

    // 📡 التحديث السحري: البث الفوري للوحة التحكم لإخبارها بأن الطلب تم تقييمه وأرشفته كلياً
    if (req.io) {
      req.io.emit(`order_status_changed_${order_id}`, {
        order_id: order_id,
        status: 'reviewed',
        message: 'شكراً لك! تم حفظ تقييمك وأرشفة الطلب بنجاح ❤️'
      });
      console.log(`🔌 [Live Review Emit] تم إرسال أمر السوكيت لمسح الطلب رقم (${order_id}) بعد تقييمه.`);
    }

    return res.status(200).json({ success: true, message: 'شكراً لمشاركتنا رأيك! ❤️' });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('❌ Error inside rateDriver:', error);
    return res.status(500).json({ success: false, message: 'خطأ في حفظ التقييم.' });
  }
};

// =========================================================================
// 5️⃣ جلب الأرشيف التاريخي للطلبات المكتملة والمقيمة للزبون
// =========================================================================
const getClientHistoryOrders = async (req, res) => {
  const user_id = parseInt(req.params.user_id, 10); 
  if (!user_id) return res.status(400).json({ success: false, message: 'معرف المستخدم مفقود.' });

  try {
    const query = `
      SELECT 
        o.id AS order_id,
        o.order_type,
        COALESCE(p.package_name, CONCAT('شراء من: ', s.store_name)) AS title,
        COALESCE(p.extra_details, s.shopping_list) AS description,
        o.status,
        p.receiver_phone,
        o.created_at
      FROM core_orders o
      LEFT JOIN package_order_details p ON o.id = p.order_id AND o.order_type = 'package'
      LEFT JOIN shopping_order_details s ON o.id = s.order_id AND o.order_type = 'shopping'
      WHERE o.user_id = $1 
        AND o.status IN ('completed', 'reviewed') 
      ORDER BY o.created_at DESC;
    `;

    const result = await db.query(query, [user_id]);
    res.status(200).json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('❌ Fetch History Orders Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء جلب الأرشيف.' });
  }
};

// =========================================================================
// 6️⃣ تحديث إعدادات الحساب والصورة الشخصية (Dynamic Profile Update)
// =========================================================================
const updateProfileSettings = async (req, res) => {
  const { user_id, full_name, phone_number, email, password } = req.body;

  if (!user_id || !full_name || !phone_number || !email || !password) {
    return res.status(400).json({ success: false, message: 'جميع الحقول بما فيها كلمة المرور مطلوبة.' });
  }

  try {
    const userCheck = await db.query(
      'SELECT full_name, phone_number, email, password_hash FROM users WHERE id = $1', 
      [user_id]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود بالرادار.' });
    }

    const currentUser = userCheck.rows[0];

    const isPasswordValid = await bcrypt.compare(password, currentUser.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'كلمة المرور المدخلة خاطئة، تعذر تعديل البيانات الشخصية 🔒' });
    }

    const cleanEmail = email.trim();
    const cleanPhone = phone_number.trim();

    if (cleanEmail !== currentUser.email) {
      const emailDuplicate = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2', 
        [cleanEmail, user_id]
      );
      if (emailDuplicate.rows.length > 0) {
        return res.status(400).json({ success: false, message: 'عذراً، البريد الإلكتروني الجديد مستخدم بالفعل لحساب آخر! ❌' });
      }
    }

    if (cleanPhone !== currentUser.phone_number) {
      const phoneDuplicate = await db.query(
        'SELECT id FROM users WHERE phone_number = $1 AND id != $2', 
        [cleanPhone, user_id]
      );
      if (phoneDuplicate.rows.length > 0) {
        return res.status(400).json({ success: false, message: 'عذراً، رقم الهاتف الجديد محجوز بالفعل لحساب آخر! ❌' });
      }
    }

    let avatarPath = null;
    if (req.file) {
      avatarPath = `/uploads/${req.file.filename}`;
    }

    let query;
    let queryParams;

    if (avatarPath) {
      query = `
        UPDATE users 
        SET full_name = $1, phone_number = $2, email = $3, avatar_url = $4
        WHERE id = $5
        RETURNING full_name, phone_number, email, avatar_url;
      `;
      queryParams = [full_name.trim(), cleanPhone, cleanEmail, avatarPath, user_id];
    } else {
      query = `
        UPDATE users 
        SET full_name = $1, phone_number = $2, email = $3
        WHERE id = $4
        RETURNING full_name, phone_number, email, avatar_url;
      `;
      queryParams = [full_name.trim(), cleanPhone, cleanEmail, user_id];
    }

    const result = await db.query(query, queryParams);
    console.log(`✨ [Smart Profile Update] تم التحديث بنجاح للمستخدم رقم (${user_id})`);

    res.status(200).json({ 
      success: true, 
      message: 'تم تحديث بيانات حسابك وصورتك الشخصية بنجاح وسرية تامة ✨',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Security Update Profile Error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'تعذر التحديث، هناك بيانات مكررة ومستخدمة في حساب آخر!' });
    }
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء تحديث البيانات.' });
  }
};

// =========================================================================
// 7️⃣ تحديث كلمة المرور بشكل أمني مشفر 🔐
// =========================================================================
const changePassword = async (req, res) => {
  const { user_id, old_password, new_password } = req.body;

  if (!user_id || !old_password || !new_password) {
    return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة لتنفيذ الإجراء.' });
  }

  try {
    const userResult = await db.query('SELECT password_hash FROM users WHERE id = $1', [user_id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود بالمنظومة.' });
    }

    const currentHash = userResult.rows[0].password_hash;

    const isMatch = await bcrypt.compare(old_password, currentHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'كلمة المرور الحالية التي أدخلتها خاطئة! ❌' });
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(new_password, salt);

    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, user_id]);

    res.status(200).json({
      success: true,
      message: 'تم تحديث كلمة المرور بنجاح وبسرية تامة 🔐'
    });

  } catch (error) {
    console.error('❌ Change Password Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء تحديث كلمة المرور.' });
  }
};

// =========================================================================
// 8️⃣ جلب قائمة الأجهزة المتصلة بالمستخدم 📡
// =========================================================================
const getConnectedDevices = async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await db.query('SELECT connected_devices FROM users WHERE id = $1', [user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود.' });
    }

    const devices = result.rows[0].connected_devices || [];
    res.status(200).json({ success: true, devices: devices });
  } catch (error) {
    console.error('Get Devices Error:', error);
    res.status(500).json({ success: false, message: 'خطأ في جلب الأجهزة النشطة من السيرفر.' });
  }
};

// =========================================================================
// 9️⃣ قطع اتصال وإنهاء جلسة جهاز نشط عن بعد 🛑
// =========================================================================
const disconnectDevice = async (req, res) => {
  const { user_id, device_id } = req.body;

  try {
    await db.query(`
      UPDATE users 
      SET connected_devices = array_remove(connected_devices, (
        SELECT dev FROM unnest(connected_devices) dev WHERE dev->>'device_id' = $1
      )::jsonb)
      WHERE id = $2
    `, [device_id, user_id]);

    res.status(200).json({ success: true, message: 'تم إنهاء جلسة الجهاز المتصل بنجاح 🛡️' });
  } catch (error) {
    console.error('Disconnect Device Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء محاولة إزالة الجهاز.' });
  }
};

// =========================================================================
// 🔟 حذف الحساب نهائياً من قاعدة البيانات وتصفية متعلقاته ⚠️
// =========================================================================
const deleteAccount = async (req, res) => {
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ success: false, message: 'معرف المستخدم مطلوب لتنفيذ الحذف.' });
  }

  try {
    await db.query('DELETE FROM user_roles WHERE user_id = $1', [user_id]);

    const deleteResult = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [user_id]);

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود أو تم حذفه مسبقاً.' });
    }

    res.status(200).json({
      success: true,
      message: 'تم مسح الحساب وكافة البيانات التابعة له بنجاح أبدي 🛡️'
    });

  } catch (error) {
    console.error('❌ Delete Account Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء محاولة حذف الحساب.' });
  }
};
// src/controllers/clientController.js

const getClientNotifications = async (req, res) => {
  const { user_id } = req.params;
  try {
    // تصفية حادة: جلب إشعارات الزبائن (client) أو الإشعارات العامة للكل (all)
    const query = `
      SELECT 
        id, title, body, COALESCE(image_url, '') AS image_url, expiry_date, created_at, recipient_type,
        ($1 = ANY(viewed_by_users)) AS is_read
      FROM notifications
      WHERE (expiry_date > NOW() OR expiry_date IS NULL)
        AND (recipient_type = 'client' OR recipient_type = 'all') -- 👈 فلترة الزبائن
      ORDER BY created_at DESC;
    `;
    const result = await db.query(query, [user_id]);
    return res.status(200).json({ success: true, notifications: result.rows });
  } catch (error) {
    console.error('❌ Error getClientNotifications:', error);
    return res.status(500).json({ success: false, message: 'خطأ سيرفر داخلي.' });
  }
};

const markClientNotificationAsRead = async (req, res) => {
  const { notification_id, user_id } = req.body;
  try {
    const query = `
      UPDATE notifications 
      SET viewed_by_users = ARRAY_APPEND(viewed_by_users, $1)
      WHERE id = $2 AND NOT ($1 = ANY(viewed_by_users))
      RETURNING id;
    `;
    await db.query(query, [parseInt(user_id, 10), parseInt(notification_id, 10)]);
    return res.status(200).json({ success: true, message: 'تم تسجيل مشاهدة الزبون بنجاح ✅' });
  } catch (error) {
    console.error('❌ Error markClientNotificationAsRead:', error);
    return res.status(500).json({ success: false, message: 'خطأ في خادم التحديث.' });
  }
};
// =========================================================================
// 🔟 تخطي تقييم السائق وأرشفة الطلب تلقائياً حياً (إصلاح تضارب السوكيت) 💨⚡
// =========================================================================
const skipDriverRating = async (req, res) => {
  const { order_id } = req.body;

  if (!order_id) {
    return res.status(400).json({ success: false, message: 'معرف الطلب مطلوب لتنفيذ التخطي.' });
  }

  try {
    // تحديث حالة الطلب فوراً في المنظومة ليصبح خارج نطاق الطلبات النشطة
    const query = `UPDATE core_orders SET status = 'reviewed' WHERE id = $1 RETURNING id;`;
    const result = await db.query(query, [order_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'لم يتم العثور على هذا الطلب في قاعدة البيانات.' });
    }

    const cleanOrderId = parseInt(order_id, 10);
    console.log(`💨 [Rating Skipped]: قام الزبون بتخطي تقييم الطلب رقم (${cleanOrderId})، تم نقله للأرشيف.`);

    // 📡 قذف الأحداث الحية بشكل منفصل لمنع التضارب:
    if (req.io) {
      // أ. إرسال إشارة لشاشة التتبع المفتوحة حالياً لتأكيد الأرشفة
      req.io.emit(`order_status_changed_${cleanOrderId}`, {
        order_id: cleanOrderId,
        status: 'reviewed',
        message: 'تم تخطي التقييم بنجاح.'
      });

      // ب. 🎯 الحل السحري: بث تنظيف فوري ومباشر يمسح الطلب من لوحة تحكم الزبون ورادار السائقين في نفس الوقت
      req.io.emit('remove_order_from_radar', { order_id: cleanOrderId });
      
      console.log(`🔌 [Live Disconnect Emit] تم فصل الأحداث بنجاح للطلب رقم (${cleanOrderId}).`);
    }

    return res.status(200).json({ success: true, message: 'تم أرشفة الرحلة وتخطي مرحلة التقييم بنجاح ✅' });

  } catch (error) {
    console.error('❌ Error inside skipDriverRating:', error);
    return res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء معالجة تخطي التقييم.' });
  }
};
const getSystemSettings = async (req, res) => {
  try {
    const result = await db.query("SELECT key_name, key_value FROM system_settings;");
    
    // تحويل المصفوفة إلى كائن (Object) يسهل على Flutter قراءته
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key_name] = parseFloat(row.key_value);
    });

    // ستُرسل النتيجة هكذا: { min_version: 1.00, min_delivery_price: 100.00, ... }
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    return res.status(500).json({ success: false, message: "خطأ في السيرفر" });
  }
};
// لا تنسَ تصدير الدوال في أسفل الملف!
module.exports = { 
  getPackageOffers, 
  getPackageStatus, 
  acceptPackageOffer, 
  rateDriver, 
  getClientHistoryOrders, 
  updateProfileSettings, 
  changePassword, 
  getConnectedDevices,
  disconnectDevice,
  deleteAccount,
  getClientNotifications,
  markClientNotificationAsRead,
  skipDriverRating,
  getSystemSettings
  
};