// src/controllers/orderController.js

const db = require('../config/db');
const { sendPushNotification } = require('../services/notificationService');

// =========================================================================
// 1️⃣ جلب طلبات الزبون النشطة فقط لمتابعتها بصفحته الشخصية
// =========================================================================
const getClientOrders = async (req, res) => {
  const user_id = parseInt(req.params.user_id, 10); 

  if (!user_id) return res.status(400).json({ success: false, message: 'معرف المستخدم مفقود.' });

  try {
    const query = `
      SELECT 
        o.id AS order_id,
        o.order_type,
        COALESCE(p.package_name, CONCAT('شراء من: ', s.store_name)) AS title,
        COALESCE(p.extra_details, s.shopping_list) AS description,
        CASE 
          WHEN o.status = 'pending_offers' AND o.order_type = 'package' THEN 'بانتظار عروض الكباتن'
          WHEN o.status = 'pending_offers' AND o.order_type = 'shopping' THEN 'بانتظار عروض الشراء'
          WHEN o.status = 'active' THEN 'جاري الاستلام الآن 🚗'
          WHEN o.status = 'picked_up' THEN 'جاري التوصيل إليك الآن 📦⚡'
          WHEN o.status = 'delivered_awaiting_cash' THEN '📦 وُصِّل الطرد! الكابتن عائد إليك بالمال 💰'
          ELSE 'تمت العملية بنجاح 🎉'
        END AS status_text,
        o.status AS raw_status, 
        COALESCE(p.receiver_phone, '')::VARCHAR AS receiver_phone,
        (SELECT COUNT(*)::INT FROM delivery_offers WHERE order_id = o.id) AS offers_count,
        o.created_at
      FROM core_orders o
      LEFT JOIN package_order_details p ON o.id = p.order_id AND o.order_type = 'package'
      LEFT JOIN shopping_order_details s ON o.id = s.order_id AND o.order_type = 'shopping'
      WHERE o.user_id = $1 
        AND o.status NOT IN ('completed', 'reviewed') -- 🎯 إبقاء حالة delivered_awaiting_cash معلقة باللوحة
      ORDER BY o.created_at DESC;
    `;

    const result = await db.query(query, [user_id]);
    res.status(200).json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('❌ Fetch Combined Orders Error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في السيرفر أثناء جلب الطلبات الموحدة.' });
  }
};

// =========================================================================
// 2️⃣ إنشاء طلب شحن طرد جديد (بث رادار سوكيت + إشعارات للكباتن النشطين 📦⚡)
// =========================================================================
const createPackageOrder = async (req, res) => {
  const { user_id, package_name, pickup_city, dropoff_city, weight_kg, extra_details, receiver_phone, latitude, longitude } = req.body;

  try {
    await db.query('BEGIN');
    
    if (latitude && longitude) {
      await db.query('UPDATE users SET latitude = $1, longitude = $2 WHERE id = $3', [latitude, longitude, user_id]);
    }

    const coreResult = await db.query(`
      INSERT INTO core_orders (user_id, order_type, pickup_address, dropoff_address, status)
      VALUES ($1, 'package', $2, $3, 'pending_offers') RETURNING id, status, created_at;
    `, [user_id, pickup_city, dropoff_city]);

    const newOrder = coreResult.rows[0];

    await db.query(`
      INSERT INTO package_order_details (order_id, package_name, weight_kg, extra_details, receiver_phone)
      VALUES ($1, $2, $3, $4, $5);
    `, [newOrder.id, package_name, weight_kg, extra_details, receiver_phone]);

    const userQuery = await db.query('SELECT full_name, phone_number, latitude, longitude FROM users WHERE id = $1', [user_id]);
    const userData = userQuery.rows[0];

    const realtimeOrderPayload = {
      id: newOrder.id, order_type: 'package', status: newOrder.status, created_at: newOrder.created_at,
      pickup_location: pickup_city, dropoff_location: dropoff_city, order_lat: userData.latitude, order_lng: userData.longitude,
      client_name: userData.full_name, client_phone: userData.phone_number, title: package_name, description: extra_details || '',
      estimated_price: '0', extra_info: weight_kg ? `${weight_kg} كغ` : 'ميزانية طرود', receiver_phone: receiver_phone || '', offers_count: 0, previous_offer: null
    };

    await db.query('COMMIT');

    if (req.io) {
      req.io.emit('new_delivery_order', realtimeOrderPayload);
    }

    const orderLat = parseFloat(userData.latitude);
    const orderLng = parseFloat(userData.longitude);

    if (orderLat && orderLng) {
      const activeDriversQuery = `
        SELECT id, fcm_token, (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) + sin(radians($1)) * sin(radians(latitude)))) AS distance_km
        FROM users WHERE is_online = true AND (default_role = 'driver' OR default_role = 'both') AND fcm_token IS NOT NULL
      `;
      const driversResult = await db.query(activeDriversQuery, [orderLat, orderLng]);
      
      driversResult.rows.forEach(async (driver) => {
        if (driver.distance_km <= 2) {
          await sendPushNotification(driver.fcm_token, '📦 طلب طرد جديد قريب منك!', `طلب لتوصيل طرد (${package_name}) على بعد ${driver.distance_km.toFixed(1)} كم.`, { order_id: newOrder.id.toString(), type: 'new_order_radar' });
        }
      });
    }

    res.status(201).json({ success: true, message: 'تم نشر طردك الموحد في الرادار بنجاح! 🚀', order: { order_id: newOrder.id, ...newOrder } });

  } catch (error) {
    await db.query('ROLLBACK');
    console.error('❌ Create Package Order Error:', error);
    res.status(500).json({ success: false, message: 'خطأ في السيرفر.' });
  }
};

// =========================================================================
// 3️⃣ إنشاء طلب شراء وتسوق جديد 🛒⚡
// =========================================================================
const createShoppingOrder = async (req, res) => {
  const { user_id, shopping_list, store_name, estimated_budget, latitude, longitude } = req.body;

  try {
    await db.query('BEGIN');
    if (latitude && longitude) {
      await db.query('UPDATE users SET latitude = $1, longitude = $2 WHERE id = $3', [latitude, longitude, user_id]);
    }

    const coreResult = await db.query(`
      INSERT INTO core_orders (user_id, order_type, pickup_address, dropoff_address, status)
      VALUES ($1, 'shopping', $2, 'موقع العميل الحالي', 'pending_offers') RETURNING id, status, created_at;
    `, [user_id, 'متجر: ' + (store_name || 'أي متجر قريب')]);

    const newOrder = coreResult.rows[0];
    await db.query(`INSERT INTO shopping_order_details (order_id, store_name, shopping_list, estimated_budget) VALUES ($1, $2, $3, $4);`, [newOrder.id, store_name || 'أي متجر قريب', shopping_list, estimated_budget]);

    const userQuery = await db.query('SELECT full_name, phone_number, latitude, longitude FROM users WHERE id = $1', [user_id]);
    const userData = userQuery.rows[0];

    const realtimeOrderPayload = {
      id: newOrder.id, order_type: 'shopping', status: newOrder.status, created_at: newOrder.created_at,
      pickup_location: 'متجر: ' + (store_name || 'أي متجر قريب'), dropoff_location: 'موقع العميل الحالي', order_lat: userData.latitude, order_lng: userData.longitude,
      client_name: userData.full_name, client_phone: userData.phone_number, title: `شراء من: ${store_name || 'أي متجر قريب'}`, description: shopping_list,
      estimated_price: estimated_budget ? estimated_budget.toString() : '0', extra_info: 'ميزانية تسوق', receiver_phone: '', offers_count: 0, previous_offer: null
    };

    await db.query('COMMIT');

    if (req.io) {
      req.io.emit('new_delivery_order', realtimeOrderPayload);
    }

    const orderLat = parseFloat(userData.latitude);
    const orderLng = parseFloat(userData.longitude);

    if (orderLat && orderLng) {
      const activeDriversQuery = `
        SELECT id, fcm_token, (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * cos(radians(longitude) - radians($2)) + sin(radians($1)) * sin(radians(latitude)))) AS distance_km
        FROM users WHERE is_online = true AND (default_role = 'driver' OR default_role = 'both') AND fcm_token IS NOT NULL
      `;
      const driversResult = await db.query(activeDriversQuery, [orderLat, orderLng]);
      
      driversResult.rows.forEach(async (driver) => {
        if (driver.distance_km <= 2) {
          await sendPushNotification(driver.fcm_token, '🛒 طلب تسوق وشراء جديد!', `طلب شراء جديد بالقرب منك على بعد ${driver.distance_km.toFixed(1)} كم.`, { order_id: newOrder.id.toString(), type: 'new_order_radar' });
        }
      });
    }

    res.status(201).json({ success: true, message: 'تم نشر طلب الشراء في الرادار بنجاح! 🛒', order: { order_id: newOrder.id, ...newOrder } });

  } catch (error) {
    await db.query('ROLLBACK');
    res.status(500).json({ success: false });
  }
};

// =========================================================================
// 4️⃣ جلب طلبات الرادار الجغرافي حياً للكباتن (تصفية حازمة وحجب الكاش المرتد 🛑)
// =========================================================================
const getRadarOrders = async (req, res) => {
  const { lat, lng, driver_id } = req.query;
  const driverLat = parseFloat(lat) || 34.7229;
  const driverLng = parseFloat(lng) || 5.4297;
  const currentDriverId = driver_id ? parseInt(driver_id, 10) : 0;

  try {
    const query = `
      WITH combined_orders AS (
        SELECT 
          o.id, o.order_type, o.status, o.created_at, o.pickup_address AS pickup_location, o.dropoff_address AS dropoff_location,
          u.latitude AS order_lat, u.longitude AS order_lng, u.full_name AS client_name, u.phone_number AS client_phone,
          COALESCE(u.promo, 0)::INT AS client_promo,
          COALESCE(p.package_name, CONCAT('شراء من: ', s.store_name))::VARCHAR AS title,
          COALESCE(p.extra_details, s.shopping_list)::VARCHAR AS description,
          COALESCE(s.estimated_budget::VARCHAR, '0') AS estimated_price,
          COALESCE(p.weight_kg::VARCHAR, 'ميزانية تسوق')::VARCHAR AS extra_info,
          COALESCE(p.receiver_phone, '')::VARCHAR AS receiver_phone, 
          (SELECT COUNT(*)::INT FROM delivery_offers WHERE order_id = o.id) AS offers_count,
          (SELECT offer_price FROM delivery_offers WHERE order_id = o.id AND driver_id = $3 LIMIT 1) AS previous_offer
        FROM core_orders o
        JOIN users u ON o.user_id = u.id
        LEFT JOIN package_order_details p ON o.id = p.order_id AND o.order_type = 'package'
        LEFT JOIN shopping_order_details s ON o.id = s.order_id AND o.order_type = 'shopping'
        WHERE o.status = 'pending_offers' AND o.driver_id IS NULL -- 🎯 حماية قفل الرادار العام فقط للطلبات المتاحة
      ),
      calculated_distances AS (
        SELECT *, (6371 * acos(cos(radians($1)) * cos(radians(order_lat)) * cos(radians(order_lng) - radians($2)) + sin(radians($1)) * sin(radians(order_lat)))) AS distance_km
        FROM combined_orders
      )
      SELECT * FROM calculated_distances WHERE distance_km <= 2 ORDER BY distance_km ASC, created_at DESC;
    `;

    const result = await db.query(query, [driverLat, driverLng, currentDriverId]);
    console.log(`📡 [Radar Central] تم جلب الطلبات، العدد: (${result.rows.length})`);

    let hasActiveTrip = false;
    if (currentDriverId > 0) {
      const activeCheck = await db.query(
        `SELECT id FROM core_orders WHERE driver_id = $1 AND status IN ('active', 'picked_up', 'delivered_awaiting_cash') LIMIT 1;`,
        [currentDriverId]
      );
      if (activeCheck.rows.length > 0) {
        hasActiveTrip = true;
      }
    }

    res.status(200).json({ 
      success: true, 
      has_active_trip: hasActiveTrip, // 🎯 حقن المتغير الجديد هنا
      orders: result.rows 
    });
  } catch (error) {
    console.error('❌ Get Radar Orders Error:', error);
    res.status(500).json({ success: false, message: 'خطأ في تصفية مسافات الرادار.' });
  }
};

// =========================================================================
// 5️⃣ إلغاء وحذف الطلب نهائياً من الرادار 🗑️
// =========================================================================
const cancelOrder = async (req, res) => {
  const orderId = parseInt(req.params.order_id, 10);
  if (!orderId) return res.status(400).json({ success: false, message: 'معرف الطلب غير صحيح.' });

  try {
    await db.query('BEGIN');
    const checkOrder = await db.query('SELECT id, order_type, status FROM core_orders WHERE id = $1', [orderId]);
    
    if (checkOrder.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'لم يتم العثور على هذا الطلب.' });
    }

    const orderData = checkOrder.rows[0];
    if (orderData.status !== 'pending_offers') {
      await db.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'لا يمكن إلغاء هذا الطلب لأن كابتن قد قبله بالفعل.' });
    }

    await db.query('DELETE FROM delivery_offers WHERE order_id = $1', [orderId]);
    if (orderData.order_type === 'package') {
      await db.query('DELETE FROM package_order_details WHERE order_id = $1', [orderId]);
    } else {
      await db.query('DELETE FROM shopping_order_details WHERE order_id = $1', [orderId]);
    }
    await db.query('DELETE FROM core_orders WHERE id = $1', [orderId]);
    await db.query('COMMIT');

    if (req.io) {
      req.io.emit('remove_order_from_radar', { order_id: orderId });
    }
    return res.status(200).json({ success: true, message: 'تم إلغاء طلبك وحذفه من الرادار بنجاح.' });

  } catch (error) {
    await db.query('ROLLBACK');
    return res.status(500).json({ success: false, message: 'خطأ سيرفر داخلي.' });
  }
};

module.exports = { getClientOrders, createPackageOrder, createShoppingOrder, getRadarOrders, cancelOrder };