const bcrypt = require('bcrypt');
const db = require('../config/db'); // تأكد من صحة مسار جلب اتصال قاعدة البيانات لديك

// 1️⃣ دالة تسجيل المستخدم الجديد (محدثة لتهيئة مصفوفة الأجهزة المتصلة وجعل الحالة معلقة)
const registerUser = async (req, res) => {
  const { 
    full_name, 
    age, 
    phone_number, 
    email, 
    password, 
    fcm_token, 
    default_role,   
    current_city,
    latitude,   
    longitude   
  } = req.body;

  try {
    // أ. التحقق من عدم تكرار البريد الإلكتروني
    const userExists = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'البريد الإلكتروني مسجل بالفعل!' 
      });
    }

    // ب. التحقق من عدم تكرار رقم الهاتف
    const phoneExists = await db.query('SELECT * FROM users WHERE phone_number = $1', [phone_number]);
    if (phoneExists.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'رقم الهاتف مسجل بالفعل!' 
      });
    }

    // ج. التحقق من السن قانونياً (حسب شروط قاعدة البيانات الخاصة بك)
    if (age < 18) {
      return res.status(400).json({ 
        success: false, 
        message: 'عذراً، يجب أن يكون عمرك 18 عاماً أو أكثر للتسجيل.' 
      });
    }

    // د. تشفير كلمة المرور لحماية الحساب
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // هـ. إدخال البيانات كاملة مع حقن المصفوفة الفارغة الافتراضية للأجهزة الحية والحالة المعلقة
    const insertUserQuery = `
      INSERT INTO users (
        full_name, age, phone_number, email, password_hash, 
        fcm_token, default_role, current_city, latitude, longitude,
        is_online, account_status, connected_devices
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING id, full_name, email, phone_number, default_role, current_city, is_verified, account_status, fcm_token
    `;

    // العضو الجديد يسجل وتكون حالته 'pending_verification' بانتظار المراجعة
    const newUser = await db.query(insertUserQuery, [
      full_name, 
      age, 
      phone_number, 
      email, 
      passwordHash, 
      fcm_token, 
      default_role || 'client', 
      current_city || 'Biskra',
      latitude,  
      longitude,
      false, 
      'pending_verification', // 🎯 تم التعديل هنا لتصبح الحالة معلقة بانتظار التحقق الإداري
      '{}' 
    ]);

    const createdUser = newUser.rows[0];

    // و. ربط المستخدم تلقائياً بجدول الأدوار المساعد
    await db.query(
      `INSERT INTO user_roles (user_id, selected_role) VALUES ($1, $2)`,
      [createdUser.id, createdUser.default_role]
    );

    // ز. إرسال رد النجاح المكتمل إلى Flutter
    res.status(201).json({
      success: true,
      message: 'تم تسجيل حسابك بنجاح وهو قيد المراجعة والتحقق الآن! ⏳',
      user: createdUser
    });

  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'حدث خطأ في السيرفر أثناء إنشاء الحساب.', 
      error: error.message 
    });
  }
};

// 2️⃣ دالة تسجيل الدخول (محدثة بالكامل لحقن وتحديث الأجهزة والـ FCM Token ديناميكياً)
const loginUser = async (req, res) => {
  // 📱 استقبل الـ fcm_token الجديد بجانب الـ device_id و device_name المرسلة من جهاز العميل
  const { email, password, device_id, device_name, fcm_token } = req.body; //

  try {
    // أ. البحث عن المستخدم بالبريد الإلكتروني
    const userResult = await db.query('SELECT * FROM users WHERE email = $1', [email]); //
    if (userResult.rows.length === 0) { //
      return res.status(401).json({ 
        success: false, 
        message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة!' 
      });
    }

    const user = userResult.rows[0]; //

    // b. فك تشفير ومطابقة كلمة المرور المحمية
    const isPasswordMatch = await bcrypt.compare(password, user.password_hash); //
    if (!isPasswordMatch) { //
      return res.status(401).json({ 
        success: false, 
        message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة!' 
      });
    }

    // 🚀 جـديد: تحديث الـ fcm_token في قاعدة البيانات حياً إذا تم إرساله من الهاتف
    if (fcm_token) {
      await db.query(
        'UPDATE users SET fcm_token = $1 WHERE id = $2',
        [fcm_token.trim(), user.id]
      );
      console.log(`🔔 [FCM Update] تم تحديث توكن الإشعارات بنجاح للمستخدم رقم (${user.id})`);
    }

    // ج. جلب الدور النشط حالياً للمستخدم من جدول الأدوار المساعد
    const roleResult = await db.query('SELECT selected_role FROM user_roles WHERE user_id = $1', [user.id]); //
    const currentRole = roleResult.rows.length > 0 ? roleResult.rows[0].selected_role : user.default_role; //

    // 🎯 د. معالجة وتحديث مصفوفة الأجهزة المتصلة بشكل أمني ذكي
    if (device_id && device_name) { //
      const newDeviceObject = JSON.stringify({ //
        device_id: device_id.trim(), //
        device_name: device_name.trim(), //
        last_login: new Date().toISOString() //
      });

      // استعلام احترافي: يزيل سجل الجهاز القديم (إن وجد بنفس الـ id) لتجنب التكرار، ثم يلحق الكائن الجديد بالتاريخ المحدث
      await db.query(`
        UPDATE users 
        SET connected_devices = array_append(
          array_remove(connected_devices, (
            SELECT dev FROM unnest(connected_devices) dev WHERE dev->>'device_id' = $1
          )::jsonb), 
          $2::jsonb
        )
        WHERE id = $3
      `, [device_id.trim(), newDeviceObject, user.id]); //
    }

    // هـ. إرسال حزمة البيانات المكتملة متمنين له رحلة آمنة في منصة واجدة
    res.status(200).json({ //
      success: true, 
      message: 'مرحباً بعودتك إلى واجدة! 🚀', //
      user: { //
        id: user.id, //
        full_name: user.full_name, //
        email: user.email, //
        phone_number: user.phone_number, //
        current_role: currentRole, //
        avatar_url: user.avatar_url,  //
        account_status: user.account_status,  //
        is_online: user.is_online, //
        latitude: user.latitude, //
        longitude: user.longitude, //
        fcm_token: fcm_token || user.fcm_token, // إرجاع التوكن الجديد أو المخزن مسبقاً للـ State
        promo: parseInt(user.promo || 0, 10) 
      }
    });

  } catch (error) {
    console.error('Login Error:', error); //
    res.status(500).json({ 
      success: false, 
      message: 'حدث خطأ داخلي في السيرفر أثناء تسجيل الدخول.'  //
    });
  }
};

module.exports = {
  registerUser,
  loginUser
};

// // 3. دالة تحديث وتبديل دور الحساب (محدثة لتدعم نظام فحص الـ account_status ثلاثي الأبعاد)
// const updateUserRole = async (req, res) => {
//   const { user_id, selected_role } = req.body;

//   try {
//     // أ. جلب حالة الحساب أولاً للتأكد من أمان الانتقال
//     const userCheck = await db.query('SELECT account_status, default_role FROM users WHERE id = $1', [user_id]);
    
//     if (userCheck.rows.length === 0) {
//       return res.status(404).json({ success: false, message: 'المستخدم غير موجود!' });
//     }

//     const user = userCheck.rows[0];

//     // ب. إذا كان المستخدم يطلب التحول إلى وضع السائق (سواء كتبها التطبيق driver أو both)
//     // نقوم بإرجاع حالة حسابه الحالية الموثقة في السيرفر ليتعامل معها Flutter
//     if (selected_role === 'driver' || selected_role === 'both') {
//       return res.status(200).json({
//         success: true,
//         message: 'تم فحص صلاحيات السائق بالسيرفر بنجاح.',
//         account_status: user.account_status, // 👈 سيرسل active أو pending_verification أو banned
//         role: user.default_role
//       });
//     }

//     // ج. في حالة العودة العادية لوضع الزبون النقي (client)
//     const userUpdateResult = await db.query(
//       'UPDATE users SET default_role = $1 WHERE id = $2 RETURNING full_name, account_status',
//       [selected_role, user_id]
//     );
    
//     await db.query(
//       'UPDATE user_roles SET selected_role = $1 WHERE user_id = $2',
//       [selected_role, user_id]
//     );

//     res.status(200).json({
//       success: true,
//       message: `تم التبديل بنجاح! 🚀`,
//       account_status: userUpdateResult.rows[0].account_status,
//       user_name: userUpdateResult.rows[0].full_name
//     });

//   } catch (error) {
//     console.error('Update Role Error:', error);
//     res.status(500).json({ success: false, message: 'حدث خطأ داخلي بالسيرفر أثناء تحديث الدور' });
//   }
// };

module.exports = {
  registerUser,
  loginUser,
  
  
};