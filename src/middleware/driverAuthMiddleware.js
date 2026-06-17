// middleware/driverAuthMiddleware.js

const isDriverAuthenticated = (req, res, next) => {
  // 💡 صمام استثناء مرن: إذا كان المسار يتضمن login أو register، لا تفحص الجلسة نهائياً وامحُ التوجيه اللانهائي
  if (req.path.includes('/login') || req.path.includes('/register') || req.path.includes('/terms')) {
  return next();
}

  // 2. التحقق من وجود جلسة نشطة
  if (req.session && req.session.driverId) {
    
    // ✅ الكابتن معتمد وصلاحيته سليمة -> مرره للوحة التحكم
    if (req.session.driverRole === 'both') {
      return next();
    } 
    
    // 🎯 زبون يريد الترقية -> وجهه لصفحة التسجيل بأمان
    if (req.session.driverRole === 'client') {
      return res.redirect('/driver/register');
    }
  }

  // 3. صمام الأمان الأخير: إذا لم تكن هناك جلسة نهائياً وكان يحاول الدخول للمسار الرئيسي، أرجعه للدخول
  console.log(`⚠️ [Auth Guard]: طلب مجهول للمسار (${req.path})، تم التوجيه لصفحة تسجيل الدخول.`);
  return res.redirect('/driver/login');
};

module.exports = { isDriverAuthenticated };