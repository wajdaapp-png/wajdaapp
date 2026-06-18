// src/controllers/driverController.js

const db = require('../config/db');
const bcrypt = require('bcrypt');
const { sendEmailInvoice } = require('../services/emailService');
const { sendPushNotification } = require('../services/notificationService');

// =========================================================================
// 🎯 دالة تحديث حالة الرادار الموحدة والمحمية مالياً (المربوطة بـ toggle-online)
// =========================================================================
const updateOnlineStatus = async (req, res) => {
  const user_id = req.body.user_id || req.body.driver_id;
  const { is_online } = req.body;
  
  if (user_id === undefined || is_online === undefined) {
    return res.status(400).json({ success: false, message: 'بيانات الطلب غير مكتملة' });
  }

  try {
    if (is_online === true || is_online === 'true') {
      const financeCheck = await db.query(
        'SELECT wallet_balance, max_debt_limit FROM users WHERE id = $1', 
        [user_id]
      );

      if (financeCheck.rows.length > 0) {
        const driver = financeCheck.rows[0];
        const walletBalance = parseFloat(driver.wallet_balance || 0); 
        const maxDebtLimit = parseFloat(driver.max_debt_limit || 1000); 

        if (walletBalance < 0 && Math.abs(walletBalance) >= maxDebtLimit) {
          console.log(`⚠️ [Debt Limit Blocked] تم منع السائق رقم (${user_id}) من الـ Online! محفظته: ${walletBalance}`); 
          return res.status(403).json({ 
            success: false, 
            is_forced_offline: true, 
            is_debt_blocked: true, 
            message: `🚨 عذراً يا كابتن! لقد تم تقييد حسابك وتجميد الرادار تلقائياً لتجاوزك سقف الدَّيْن الأقصى المسموح به في منصة واجدة وهو (${maxDebtLimit.toFixed(0)} د.ج).` 
          });
        }
      }
    }

    const result = await db.query(
      'UPDATE users SET is_online = $1 WHERE id = $2 RETURNING full_name, is_online', 
      [is_online, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود!' }); 
    }

    console.log(`🟢 [Online Status Updated] الكابتن: ${result.rows[0].full_name} حالته الآن: ${result.rows[0].is_online}`); 
    return res.status(200).json({ success: true, is_online: result.rows[0].is_online }); 

  } catch (error) {
    console.error('❌ Error inside updateOnlineStatus:', error); 
    return res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء تحديث حالة الاتصال.' }); 
  }
};

// =========================================================================
// 2️⃣ قبول طلب الشراء الفوري وتحديث حالته (محقون بإشعارات الزبون 🔔)
// =========================================================================
const acceptShoppingOrder = async (req, res) => {
  const { order_id, driver_id } = req.body;
  
  try {
    await db.query('BEGIN');

    // 🔒 1. صمام الأمان اللوجستي: فحص إذا كان السائق مشغولاً برحلة أخرى لم تنتهِ بعد
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
        message: '🚨 عذراً يا كابتن! لا يمكنك قبول طلب جديد حتى تقوم بإكمال رحلتك الحالية وتسليم الأمانة المستحقة أولاً.' 
      });
    }

    // 🟢 2. المسار الطبيعي إذا كان السائق متفرغاً
    const query = `UPDATE core_orders SET status = 'active', driver_id = $1 WHERE id = $2 AND status = 'pending_offers' RETURNING id, user_id;`;
    const result = await db.query(query, [driver_id, order_id]);
    if (result.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'الطلب لم يعد متاحاً.' });
    }
    
    const acceptedOrder = result.rows[0];
    const infoQuery = await db.query(
      `SELECT d.full_name AS driver_name, u.fcm_token FROM users d, users u WHERE d.id = $1 AND u.id = $2`,
      [driver_id, acceptedOrder.user_id]
    );
    const { driver_name, fcm_token } = infoQuery.rows[0];

    await db.query('COMMIT');

    if (req.io) {
      req.io.emit(`order_status_changed_${acceptedOrder.id}`, { order_id: acceptedOrder.id, status: 'active', message: 'تم قبول طلب الشراء الخاص بك وجاري التنفيذ 🚗' });
    }

    await sendPushNotification(fcm_token, '🛒 تم قبول طلب الشراء الخاص بك!', `وافق الكابتن ${driver_name} على طلب التسوق الخاص بك وهو الآن في طريقه للمتجر.`, { order_id: acceptedOrder.id.toString(), type: 'shopping_accepted' });

    res.status(200).json({ success: true, message: 'تم قبول طلب الشراء بنجاح 🤝' });
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('❌ Accept Shopping Order Error:', error);
    res.status(500).json({ success: false, message: 'خطأ بالسيرفر.' });
  }
};

// =========================================================================
// 3️⃣ تقديم أو تعديل عرض السعر الفوري (نسخة مؤمنة من التداخل والطلبات الجارية 💸⚡)
// =========================================================================
const submitDeliveryOffer = async (req, res) => {
  const { package_id, driver_id, offer_price, order_type } = req.body; 

  if (!package_id || !driver_id || !offer_price || !order_type) {
    return res.status(400).json({ success: false, message: 'المعطيات ناقصة لمعالجة العرض الموحد.' });
  }

  try {
    // 🔒 صمام الأمان اللوجستي: منع السائق المشغول برحلة أخرى من تقديم أو تعديل أي سعر نهائياً
    const busyCheck = await db.query(
      `SELECT id FROM core_orders 
       WHERE driver_id = $1 
         AND status IN ('active', 'picked_up', 'delivered_awaiting_cash') 
       LIMIT 1;`,
      [driver_id]
    );

    if (busyCheck.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: '🚨 اختراق أمني لوجستي: لا يمكنك تقديم عروض أسعار جديدة حتى تقوم بإكمال رحلتك الحالية وتسليم الأمانة المعلقة!' 
      });
    }

    const checkQuery = `SELECT id FROM delivery_offers WHERE order_id = $1 AND order_type = $2 AND driver_id = $3`;
    const existCheck = await db.query(checkQuery, [package_id, order_type, driver_id]);

    const driverInfoQuery = await db.query(
      `SELECT full_name, phone_number, COALESCE(rating, 5.0)::NUMERIC AS rating, COALESCE(avatar_url, '') AS avatar_url FROM users WHERE id = $1`,
      [driver_id]
    );
    const driver = driverInfoQuery.rows[0];

    if (!driver) {
      return res.status(404).json({ success: false, message: 'بيانات السائق غير موجودة بالنظام.' });
    }

    const clientInfoQuery = await db.query(
      `SELECT u.fcm_token FROM core_orders o JOIN users u ON o.user_id = u.id WHERE o.id = $1`,
      [package_id]
    );
    const clientFcmToken = clientInfoQuery.rows[0]?.fcm_token;

    let result;
    let isUpdate = false;

    if (existCheck.rows.length > 0) {
      const updateQuery = `
        UPDATE delivery_offers SET offer_price = $1, created_at = CURRENT_TIMESTAMP
        WHERE order_id = $2 AND order_type = $3 AND driver_id = $4 RETURNING id, offer_price, order_id, order_type, created_at;
      `;
      result = await db.query(updateQuery, [offer_price, package_id, order_type, driver_id]);
      isUpdate = true;
    } else {
      const insertQuery = `
        INSERT INTO delivery_offers (order_id, order_type, driver_id, offer_price, status)
        VALUES ($1, $2, $3, $4, 'pending') RETURNING id, offer_price, order_id, order_type, created_at;
      `;
      result = await db.query(insertQuery, [package_id, order_type, driver_id, offer_price]);
    }

    const offerData = result.rows[0];

    const realtimeOfferPayload = {
      offer_id: offerData.id,
      order_id: offerData.order_id,
      order_type: offerData.order_type,
      driver_id: driver_id,
      offer_price: parseFloat(offerData.offer_price),
      created_at: offerData.created_at,
      driver_name: driver.full_name,
      driver_phone: driver.phone_number,
      driver_rating: parseFloat(driver.rating),
      driver_avatar: driver.avatar_url
    };

    if (req.io) {
      req.io.emit(`new_offer_received_${package_id}`, realtimeOfferPayload);
    }

    if (clientFcmToken) {
      const notificationTitle = isUpdate ? '⚡ تم تعديل عرض سعر!' : '💸 عرض سعر جديد على طلبك!';
      const notificationBody = isUpdate 
        ? `قام الكابتن ${driver.full_name} بتحديث عرض السعر الخاص به ليكون ${offer_price} د.ج.`
        : `أرسل الكابتن ${driver.full_name} عرض سعر بقيمة ${offer_price} د.ج لتوصيل طلبك الآن.`;

      await sendPushNotification(clientFcmToken, notificationTitle, notificationBody, { order_id: package_id.toString(), type: 'new_order' });
    }

    return res.status(isUpdate ? 200 : 201).json({ success: true, message: 'تم معالجة العرض المالي الموحد.', offer: offerData });

  } catch (error) {
    console.error('❌ Submit Offer Unified Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ بالسيرفر أثناء معالجة العرض المالي.' });
  }
};
// =========================================================================
// 4️⃣ جلب رحلات السائق النشطة الحالية للتابلوه (محدثة بالكامل للمراحل الثلاث 🧭)
// =========================================================================
const getDriverTrips = async (req, res) => {
  const { driverId } = req.params; 
  const currentDriverId = parseInt(driverId, 10) || 0;

  try {
    const query = `
      SELECT 
        o.id::INT,
        o.order_type,
        o.status::VARCHAR,
        COALESCE(o.pickup_address, ('متجر: ' || s.store_name))::VARCHAR AS pickup,
        COALESCE(o.dropoff_address, 'موقع العميل الحالي')::VARCHAR AS dropoff,
        COALESCE(p.package_name, s.shopping_list)::VARCHAR AS title,
        COALESCE(p.receiver_phone, '')::VARCHAR AS receiver_phone,
        
        u.latitude AS order_lat,
        u.longitude AS order_lng,
        u.full_name AS client_name,
        u.phone_number AS client_phone,
        COALESCE(u.promo, 0)::INT AS client_promo,

        COALESCE(
          (SELECT offer_price::VARCHAR FROM delivery_offers WHERE order_id = o.id AND driver_id = $1 AND status = 'accepted' LIMIT 1),
          s.estimated_budget::VARCHAR, '0'
        ) AS final_price
      FROM core_orders o
      JOIN users u ON o.user_id = u.id 
      LEFT JOIN package_order_details p ON o.id = p.order_id AND o.order_type = 'package'
      LEFT JOIN shopping_order_details s ON o.id = s.order_id AND o.order_type = 'shopping'
      WHERE o.driver_id = $1 AND o.status IN ('active', 'picked_up', 'delivered_awaiting_cash') -- 🎯 ضمان جلب المراحل الثلاث حياً فورا
      ORDER BY o.created_at DESC;
    `;

    const result = await db.query(query, [currentDriverId]);
    res.status(200).json({ success: true, trips: result.rows });
  } catch (error) {
    console.error('❌ Error in getDriverTrips:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================================
// 🎯 دالة الإغلاق المالي وتحديث حالة التوصيل (مصححة ومقفلة كلياً لدورة كاش الطرود الـ COD 📦💰)
// src/controllers/clientController.js (تحديث دالة completeTrip)

const completeTrip = async (req, res) => {
  const { order_id, order_type, driver_id, final_price } = req.body;

  if (!order_id || !order_type || !driver_id || !final_price) {
    return res.status(400).json({ success: false, message: 'المعطيات ناقصة لإتمام معالجة الرحلة.' });
  }

  const parsedPrice = parseFloat(final_price);

  try {
    await db.query('BEGIN');

    // 🔍 تعديل الاستعلام: جلب تفاصيل هاتف المستلم، الـ user_id، والبريد الإلكتروني للزبون (email) واسمه
    const checkCODQuery = `
      SELECT p.receiver_phone, o.user_id, u2.email AS client_email, u2.full_name AS client_name
      FROM core_orders o
      JOIN users u2 ON o.user_id = u2.id
      LEFT JOIN package_order_details p ON o.id = p.order_id
      WHERE o.id = $1 LIMIT 1;
    `;
    const codCheckResult = await db.query(checkCODQuery, [order_id]);
    const orderDetail = codCheckResult.rows[0];

    const hasReceiver = orderDetail && 
                        orderDetail.receiver_phone && 
                        orderDetail.receiver_phone.toString().trim() !== '' && 
                        orderDetail.receiver_phone.toString().trim() !== 'لا يوجد مستلم (توصيل شخصي)';

    // 🟢 دورة كاش الطرود (COD Phase 2)
    if (order_type === 'package' && hasReceiver) {
      const updateToCODQuery = `
        UPDATE core_orders 
        SET status = 'delivered_awaiting_cash' 
        WHERE id = $1 AND driver_id = $2 AND status = 'picked_up'
        RETURNING id, user_id;
      `;
      const codResult = await db.query(updateToCODQuery, [order_id, driver_id]);

      if (codResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'تعذر التحديث، تأكد من سحب حالة الاستلام المسبق أولاً.' });
      }

      await db.query('COMMIT');
      console.log(`📦 [COD Phase 2 Activated]: الطرد #${order_id} وُصِّل للمستقبل. السائق في طريقه للمرسل بالمال.`);

      if (req.io) {
        req.io.emit(`order_status_changed_${order_id}`, {
          order_id: order_id,
          status: 'delivered_awaiting_cash',
          message: '📦 سُلِّم الطرد للمستقبل! الكابتن في طريقه إليك الآن لتسليمك الأموال 💰'
        });
      }
      return res.status(200).json({ 
        success: true, 
        is_forced_offline: false, 
        message: '📦 تم تأكيد تسليم الطرد للمستقبل بنجاح! ارتد الآن للمرسل لتسليمه المال يدوياً وقفل الفاتورة.' 
      });
    }

    // 🛒 إغلاق طلبات التسوق والطرود المباشرة
    const updateOrderQuery = `
      UPDATE core_orders 
      SET status = 'completed' 
      WHERE id = $1 AND driver_id = $2 AND status IN ('active', 'picked_up')
      RETURNING id, user_id;
    `;
    const orderResult = await db.query(updateOrderQuery, [order_id, driver_id]);

    if (orderResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'عذراً، لم نتمكن من إغلاق الرحلة الجارية.' });
    }

    const completedOrder = orderResult.rows[0];
    await db.query(`UPDATE delivery_offers SET status = 'completed' WHERE order_id = $1 AND driver_id = $2 AND status = 'accepted';`, [order_id, driver_id]);

    const taxSettingsResult = await db.query("SELECT key_name, key_value FROM system_settings WHERE key_name IN ('driver_tax_percentage', 'client_fixed_fee')");
    let taxPercentage = 5.0; 
    let baseClientFixedFee = 50.0;

    taxSettingsResult.rows.forEach(row => {
      if (row.key_name === 'driver_tax_percentage') taxPercentage = parseFloat(row.key_value);
      if (row.key_name === 'client_fixed_fee') baseClientFixedFee = parseFloat(row.key_value);
    });

    // 🎯 قراءة البرومو كود المطبق على الطلب بدقة لحساب التكلفة الفعلية للفاتورة
    const orderPromoQuery = `
      SELECT COALESCE(
        (SELECT discount_percentage FROM promo_codes WHERE code = p.promo_code_used OR code = s.promo_code_used LIMIT 1),
        u.promo, 
        0
      )::INT AS promo
      FROM core_orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN package_order_details p ON o.id = p.order_id AND o.order_type = 'package'
      LEFT JOIN shopping_order_details s ON o.id = s.order_id AND o.order_type = 'shopping'
      WHERE o.id = $1;
    `;
    const clientPromoResult = await db.query(orderPromoQuery, [order_id]);
    const clientPromo = clientPromoResult.rows[0]?.promo || 0;

    const finalClientFixedFee = baseClientFixedFee * (1 - (clientPromo / 100));
    const driverCommission = parsedPrice * (taxPercentage / 100);
    const totalPlatformCut = driverCommission + finalClientFixedFee;
    const driverPureRevenue = parsedPrice - driverCommission;

    const updateDriverFinanceQuery = `
      UPDATE users 
      SET wallet_balance = wallet_balance - $1, total_driver_revenue = total_driver_revenue + $2, total_platform_commissions = total_platform_commissions + $1
      WHERE id = $3 RETURNING wallet_balance, max_debt_limit, full_name;
    `;
    const driverFinanceResult = await db.query(updateDriverFinanceQuery, [totalPlatformCut, driverPureRevenue, driver_id]);
    
    const invoiceNo = `INV-${Date.now().toString().slice(-8)}-${order_id}`;
    const totalInvoiceAmount = parsedPrice + finalClientFixedFee;
    
    const insertInvoiceQuery = `
      INSERT INTO invoices (
        invoice_no, order_id, client_id, driver_id, order_type, trip_price, driver_tax_percent, driver_tax_amount, client_fixed_fee, client_promo_percent, client_fee_after_promo, total_platform_earnings, driver_net_profit, total_invoice_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
    `;
    await db.query(insertInvoiceQuery, [invoiceNo, order_id, completedOrder.user_id, driver_id, order_type, parsedPrice, taxPercentage, driverCommission, baseClientFixedFee, clientPromo, finalClientFixedFee, totalPlatformCut, driverPureRevenue, totalInvoiceAmount]);

    let isDriverForcedOffline = false;
    let fallbackMessage = '🎉 مبارك! تم إنهاء التوصيلة وتحديث الحسابات والمحفظة بنجاح تام.';

    if (driverFinanceResult.rows.length > 0) {
      const driverData = driverFinanceResult.rows[0];
      if (parseFloat(driverData.wallet_balance) < 0 && Math.abs(parseFloat(driverData.wallet_balance)) >= parseFloat(driverData.max_debt_limit)) {
        isDriverForcedOffline = true;
        await db.query(`UPDATE users SET is_online = false WHERE id = $1;`, [driver_id]);
        fallbackMessage = `🚨 عذراً يا كابتن! تم تجميد الرادار تلقائياً لتجاوزك سقف الدَّيْن المسموح به.`;
      }
    }

    const userQuery = await db.query('SELECT fcm_token FROM users WHERE id = $1', [completedOrder.user_id]);
    const userFcmToken = userQuery.rows[0]?.fcm_token;

    await db.query('COMMIT');
    
    // 📨 [بدء فحص محرك الفواتير البريدية حياً]
    console.log(`🔎 [Email Check] فحص بيانات العميل للطلب #${order_id}:`, {
      hasOrderDetail: !!orderDetail,
      client_email: orderDetail ? orderDetail.client_email : 'مفقود كلياً',
      client_name: orderDetail ? orderDetail.client_name : 'مفقود كلياً'
    });

    if (orderDetail && orderDetail.client_email) {
      console.log(`🚀 [Email Trigger] جاري إرسال الفاتورة الآن إلى: ${orderDetail.client_email}...`);
      
      sendEmailInvoice(
        orderDetail.client_email, 
        orderDetail.client_name, 
        invoiceNo, 
        order_id, 
        order_type, 
        parsedPrice, 
        finalClientFixedFee, 
        totalInvoiceAmount,
        clientPromo
      )
      .then((info) => {
        // نجاح الإرسال من طرف سيرفر الـ SMTP
        console.log(`✅ [Email Success] تم إرسال الفاتورة بنجاح فخم! MessageId: ${info.messageId}`);
        console.log(`📬 [Email Response] رد سيرفر البريد:`, info.response);
      })
      .catch(err => {
        // التقاط خطأ الـ SMTP (مثل كلمة مرور الإيميل خاطئة أو الهوست مغلق)
        console.error("❌ [Email SMTP Error] فشل محرك الإرسال أثناء الاتصال بالسيرفر البريدي:", err);
      });
    } else {
      console.warn(`⚠️ [Email Skipped] تم تخطي إرسال الإيميل! السبب: شرط الـ IF لم يتحقق (إما orderDetail مفقود أو حقل client_email فارغ في قاعدة البيانات).`);
    }
    
    if (req.io) {
      req.io.emit(`order_status_changed_${order_id}`, { order_id: order_id, status: 'completed', message: 'وصل الكابتن وتم تسليم الأمانة بنجاح! 🎉' });
      req.io.emit(`local_trip_completed_sync_${driver_id}`, { order_id: order_id });
      req.io.emit('remove_order_from_radar', { order_id: order_id }); 
      if (isDriverForcedOffline) {
        req.io.emit(`driver_forced_offline_${driver_id}`, { driver_id: driver_id, is_online: false, message: fallbackMessage });
      }
    }

    if (userFcmToken) {
      await sendPushNotification(userFcmToken, '🎉 وصلت شحنتك بسلام!', 'أكد الكابتن تسليم الطلب بنجاح. يرجى تقييم الكابتن الآن بالنجوم.', { order_id: order_id.toString(), type: 'trip_completed', status: 'completed' });
    }

    return res.status(200).json({ success: true, is_forced_offline: isDriverForcedOffline, message: fallbackMessage });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('❌ Complete Trip Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في السيرفر.' });
  }
};

// =========================================================================
// 6️⃣ تحديث مسار وحالة الرحلة حياً (نسخة فولاذية مع حماية عزل طلبات التسوق 🧭⚡)
// =========================================================================
const updateTripStatus = async (req, res) => {
  const { order_id, status } = req.body;

  if (!order_id || !status) {
    return res.status(400).json({ success: false, message: 'المعطيات غير مكتملة لتحديث حالة التتبع الجاري.' });
  }

  try {
    const query = `UPDATE core_orders SET status = $1 WHERE id = $2 RETURNING id, status, order_type, user_id;`;
    const result = await db.query(query, [status, order_id]);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'الطلب غير موجود.' });

    const updatedOrder = result.rows[0];
    const cleanOrderId = parseInt(updatedOrder.id, 10); 

    let liveMessage = 'تم تحديث مسار الطلب الحركي الموحد ⚡';
    if (updatedOrder.status === 'active') {
      liveMessage = updatedOrder.order_type === 'shopping' 
        ? 'الكابتن متوجه للمتجر لشراء الأغراض الآن 🛒' 
        : 'الكابتن متوجه للاستلام الآن 🚗';
    } else if (updatedOrder.status === 'picked_up') {
      liveMessage = 'الطلب في الطريق إليك الآن 📦⚡';
    } else if (updatedOrder.status === 'delivered_awaiting_cash') { 
      if (updatedOrder.order_type === 'package') {
        liveMessage = '📦 سُلِّم الطرد للمستقبل! الكابتن في طريقه إليك الآن لتسليمك الأموال 💰';
      } else {
        liveMessage = 'تمت عملية التوصيل وبانتظار الحسم المالي 💵🤝';
      }
    } else if (updatedOrder.status === 'completed' || updatedOrder.status === 'delivered') {
      liveMessage = 'تمت العملية وتوصيل الأمانة بنجاح 🎉';
    }

    const userQuery = await db.query('SELECT fcm_token FROM users WHERE id = $1', [updatedOrder.user_id]);
    const userFcmToken = userQuery.rows[0]?.fcm_token;

    if (req.io) {
      req.io.emit(`order_status_changed_${cleanOrderId}`, {
        order_id: cleanOrderId,
        status: updatedOrder.status,
        order_type: updatedOrder.order_type, // 🎯 حقن نوع الطلب حياً في السوكيت لمنع تعليق الفرونت إند
        message: liveMessage
      });
      console.log(`📡 [Live Track Emit] طلب (${updatedOrder.order_type}): تم بث تحديث الحالة للرقم (${cleanOrderId}) إلى: ${updatedOrder.status}`);
    }

    if (userFcmToken) {
      await sendPushNotification(userFcmToken, '🧭 تحديث في مسار شحنتك المباشرة', liveMessage, { order_id: cleanOrderId.toString(), type: 'trip_status_changed', status: updatedOrder.status });
    }

    res.status(200).json({ success: true, message: 'تم تحديث مسار الرحلة حياً بنجاح ⚡' });
  } catch (error) {
    console.error('❌ Update Trip Status Error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء تحديث حالة التتبع الحية.' });
  }
};

// =========================================================================
// 🎯 دالة الفحص المالي الاستباقي لمحفظة السائق قبل تفعيل الرادار
// =========================================================================
const checkDriverFinanceStatus = async (req, res) => {
  const { id } = req.params; 
  if (!id || id === 'undefined' || id === 'null') {
    return res.status(400).json({ success: false, message: 'معرّف السائق مفقود.' });
  } 

  try {
    const query = 'SELECT wallet_balance, max_debt_limit, full_name, default_role, account_status FROM users WHERE id = $1';
    const financeCheck = await db.query(query, [id]); 

    if (financeCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'عذراً، لم يتم العثور على الحساب.' });
    } 

    const driver = financeCheck.rows[0]; 
    const walletBalance = parseFloat(driver.wallet_balance || 0); 
    const maxDebtLimit = parseFloat(driver.max_debt_limit || 1000); 

    if (walletBalance < 0 && Math.abs(walletBalance) >= maxDebtLimit) { 
      return res.status(200).json({  
        success: true, 
        is_forced_offline: true, // تفعيل الطرد الحركي الحقيقي حياً
        role: driver.default_role, 
        account_status: driver.account_status, 
        message: `🚨 عذراً يا كابتن! لقد تم تقييد حسابك لتجاوزك سقف الدَّيْن.` 
      }); 
    }

    return res.status(200).json({
      success: true,
      is_forced_offline: false, 
      role: driver.default_role, 
      account_status: driver.account_status, 
      message: 'حساب الكابتن سليم مالياً ومستعد للاتصال ✅' 
    });

  } catch (error) { 
    console.error('❌ Error in checkDriverFinanceStatus:', error); 
    return res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم.' }); 
  }
};

// =========================================================================
// 🎯 دالة جلب التقارير والمحفظة المالية الكاملة والتراكمية للكابتن
// =========================================================================
const getDriverFinanceDetails = async (req, res) => {
  const { id } = req.params;
  if (!id || id === 'undefined' || id === 'null') {
    return res.status(400).json({ success: false, message: 'معرّف السائق مفقود.' });
  }

  try {
    const query = `
      SELECT id, full_name, COALESCE(wallet_balance, 0.0)::NUMERIC AS wallet_balance, COALESCE(max_debt_limit, 1000.0)::NUMERIC AS max_debt_limit,
             COALESCE(total_driver_revenue, 0.0)::NUMERIC AS total_driver_revenue, COALESCE(total_platform_commissions, 0.0)::NUMERIC AS total_platform_commissions
      FROM users WHERE id = $1;
    `;
    const result = await db.query(query, [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'السائق غير موجود.' });

    const financeData = result.rows[0];
    return res.status(200).json({
      success: true,
      user: {
        wallet_balance: parseFloat(financeData.wallet_balance),
        max_debt_limit: parseFloat(financeData.max_debt_limit),
        total_driver_revenue: parseFloat(financeData.total_driver_revenue),
        total_platform_commissions: parseFloat(financeData.total_platform_commissions),
        full_name: financeData.full_name
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'خطأ في خادم الحسابات.' });
  }
};

const getDriverRevenueHistory = async (req, res) => {
  const { id } = req.params;
  try {
    const tripsQuery = `SELECT order_id, order_type, created_at AS date, driver_net_profit AS net_profit FROM invoices WHERE driver_id = $1 ORDER BY created_at DESC;`;
    const tripsResult = await db.query(tripsQuery, [id]);
    const count24hResult = await db.query(`SELECT COUNT(*)::INT as count FROM invoices WHERE driver_id = $1 AND created_at >= NOW() - INTERVAL '1 day';`, [id]);
    const count7Result = await db.query(`SELECT COUNT(*)::INT as count FROM invoices WHERE driver_id = $1 AND created_at >= NOW() - INTERVAL '7 days';`, [id]);

    const history = tripsResult.rows.map(row => ({
      order_id: row.order_id, order_type: row.order_type, date: row.date, net_profit: parseFloat(row.net_profit).toFixed(2)
    }));
    return res.status(200).json({ success: true, completed_24h: count24hResult.rows[0].count || 0, completed_7d: count7Result.rows[0].count || 0, history });
  } catch (e) { return res.status(500).json({ success: false }); }
};

const getDriverCommissionsHistory = async (req, res) => {
  const { id } = req.params;
  try {
    const query = `SELECT order_id, order_type, created_at AS date, driver_tax_amount AS driver_tax, client_fee_after_promo AS client_fee, total_platform_earnings AS total_commission FROM invoices WHERE driver_id = $1 ORDER BY created_at DESC;`;
    const result = await db.query(query, [id]);
    const history = result.rows.map(row => ({
      order_id: row.order_id, order_type: row.order_type, date: row.date, driver_tax: parseFloat(row.driver_tax).toFixed(0), client_fee: parseFloat(row.client_fee).toFixed(0), total_commission: parseFloat(row.total_commission).toFixed(0)
    }));
    return res.status(200).json({ success: true, history });
  } catch (e) { return res.status(500).json({ success: false }); }
};

const getActiveNotifications = async (req, res) => {
  const { user_id } = req.params;
  try {
    const query = `SELECT id, title, body, COALESCE(image_url, '') AS image_url, expiry_date, created_at, recipient_type, ($1 = ANY(viewed_by_users)) AS is_read FROM notifications WHERE (expiry_date > NOW() OR expiry_date IS NULL) AND (recipient_type = 'driver' OR recipient_type = 'all') ORDER BY created_at DESC;`;
    const result = await db.query(query, [user_id]);
    return res.status(200).json({ success: true, notifications: result.rows });
  } catch (e) { return res.status(500).json({ success: false }); }
};

const markNotificationAsRead = async (req, res) => {
  const { notification_id, user_id } = req.body;
  try {
    const query = `UPDATE notifications SET viewed_by_users = ARRAY_APPEND(viewed_by_users, $1) WHERE id = $2 AND NOT ($1 = ANY(viewed_by_users)) RETURNING id;`;
    await db.query(query, [parseInt(user_id, 10), parseInt(notification_id, 10)]);
    return res.status(200).json({ success: true, message: 'تم تسجيل مشاهدة الإشعار بنجاح.' });
  } catch (e) { return res.status(500).json({ success: false }); }
};

// =========================================================================
// 🎯 دالة تسليم كاش الـ COD من السائق للمرسل وإغلاق الرحلة مالياً نهائياً (الحسم النهائي 💰🔒)
// =========================================================================
const handOverCashToSender = async (req, res) => {
  const { order_id, driver_id, final_price } = req.body;
  const parsedPrice = parseFloat(final_price);

  if (!order_id || !driver_id || !final_price) {
    return res.status(400).json({ success: false, message: 'المعطيات ناقصة لتأكيد تسليم الأموال.' });
  }

  try {
    await db.query('BEGIN');

    // 1. تحديث حالة الطرد الـ COD من معلق الكاش إلى مكتمل نهائياً
    const updateOrderQuery = `
      UPDATE core_orders 
      SET status = 'completed' 
      WHERE id = $1 AND driver_id = $2 AND status = 'delivered_awaiting_cash'
      RETURNING id, user_id, order_type;
    `;
    const orderResult = await db.query(updateOrderQuery, [order_id, driver_id]);

    if (orderResult.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'عذراً، لم نتمكن من الحسم، قد يكون تم إغلاق الطلب مسبقاً.' });
    }

    const completedOrder = orderResult.rows[0];
    await db.query(`UPDATE delivery_offers SET status = 'completed' WHERE order_id = $1 AND driver_id = $2 AND status = 'accepted';`, [order_id, driver_id]);

    const taxSettingsResult = await db.query("SELECT key_name, key_value FROM system_settings WHERE key_name IN ('driver_tax_percentage', 'client_fixed_fee')");
    let taxPercentage = 5.0; 
    let baseClientFixedFee = 50.0;

    taxSettingsResult.rows.forEach(row => {
      if (row.key_name === 'driver_tax_percentage') taxPercentage = parseFloat(row.key_value);
      if (row.key_name === 'client_fixed_fee') baseClientFixedFee = parseFloat(row.key_value);
    });

    const clientPromoResult = await db.query("SELECT COALESCE(promo, 0)::INT AS promo FROM users WHERE id = $1", [completedOrder.user_id]);
    const clientPromo = clientPromoResult.rows[0]?.promo || 0;

    const finalClientFixedFee = baseClientFixedFee * (1 - (clientPromo / 100));
    const driverCommission = parsedPrice * (taxPercentage / 100);
    const totalPlatformCut = driverCommission + finalClientFixedFee;
    const driverPureRevenue = parsedPrice - driverCommission;

    const updateDriverFinanceQuery = `
      UPDATE users 
      SET wallet_balance = wallet_balance - $1, total_driver_revenue = total_driver_revenue + $2, total_platform_commissions = total_platform_commissions + $1
      WHERE id = $3 RETURNING wallet_balance, max_debt_limit, full_name;
    `;
    const driverFinanceResult = await db.query(updateDriverFinanceQuery, [totalPlatformCut, driverPureRevenue, driver_id]);
    
    const invoiceNo = `INV-${Date.now().toString().slice(-8)}-${order_id}`;
    const totalInvoiceAmount = parsedPrice + finalClientFixedFee;
    const insertInvoiceQuery = `
      INSERT INTO invoices (
        invoice_no, order_id, client_id, driver_id, order_type, trip_price, driver_tax_percent, driver_tax_amount, client_fixed_fee, client_promo_percent, client_fee_after_promo, total_platform_earnings, driver_net_profit, total_invoice_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
    `;
    await db.query(insertInvoiceQuery, [invoiceNo, order_id, completedOrder.user_id, driver_id, completedOrder.order_type, parsedPrice, taxPercentage, driverCommission, baseClientFixedFee, clientPromo, finalClientFixedFee, totalPlatformCut, driverPureRevenue, totalInvoiceAmount]);

    let isDriverForcedOffline = false;
    let fallbackMessage = '🎉 تم تأكيد تسليم أموال الكاش يدوياً للمرسل وإغلاق الفاتورة بنجاح التام!';

    if (driverFinanceResult.rows.length > 0) {
      const driverData = driverFinanceResult.rows[0];
      if (parseFloat(driverData.wallet_balance) < 0 && Math.abs(parseFloat(driverData.wallet_balance)) >= parseFloat(driverData.max_debt_limit)) {
        isDriverForcedOffline = true;
        await db.query(`UPDATE users SET is_online = false WHERE id = $1;`, [driver_id]);
        fallbackMessage = `🚨 عذراً يا كابتن! تم إغلاق التوصيلة ولكن تم تقييد حسابك لتجاوز سقف الدين المسموح.`;
      }
    }

    const userQuery = await db.query('SELECT fcm_token FROM users WHERE id = $1', [completedOrder.user_id]);
    const userFcmToken = userQuery.rows[0]?.fcm_token;

    await db.query('COMMIT');

    if (req.io) {
      req.io.emit(`order_status_changed_${order_id}`, { order_id: order_id, status: 'completed', message: '🎉 استلمت أموالك كاش بنجاح! تم قفل الرحلة وأرشفتها.' });
      req.io.emit(`local_trip_completed_sync_${driver_id}`, { order_id: order_id });
      req.io.emit('remove_order_from_radar', { order_id: order_id }); 
      if (isDriverForcedOffline) {
        req.io.emit(`driver_forced_offline_${driver_id}`, { driver_id: driver_id, is_online: false, message: fallbackMessage });
      }
    }

    if (userFcmToken) {
      await sendPushNotification(userFcmToken, '💰 تم استلام مستحقاتك الكاش!', 'أكد الكابتن تسليم أموال الطرد إليك يدوياً بنجاح. يرجى تقييم الكابتن الآن.', { order_id: order_id.toString(), type: 'trip_completed', status: 'completed' });
    }

    return res.status(200).json({ success: true, is_forced_offline: isDriverForcedOffline, message: fallbackMessage });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('❌ handOverCashToSender Error:', error);
    return res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم.' });
  }
};

module.exports = { 
  updateOnlineStatus, acceptShoppingOrder, submitDeliveryOffer, getDriverTrips, completeTrip, updateTripStatus,
  checkDriverFinanceStatus, getDriverFinanceDetails, getDriverRevenueHistory, getDriverCommissionsHistory,
  getActiveNotifications, markNotificationAsRead, handOverCashToSender
};