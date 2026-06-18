const axios = require('axios');

/**
 * دالة إرسال كود التحقق OTP عبر منصة EasySendSMS
 * @param {string} phoneNumber - رقم الزبون بالصيغة الدولية وبدون أصفار أو زائد (مثال: 213661234567)
 * @param {string} otpCode - كود التحقق المكون من 6 أرقام
 */
const sendWajdaOTP = async (phoneNumber, otpCode) => {
    // 1. تنظيف وتجهيز رقم الهاتف (كشط الزائد أو الصفر الدولي الأول إن وُجد لضمان الصيغة المطلوبة)
    let cleanPhone = phoneNumber.trim().replace(/^\+/, '').replace(/^00/, '');
    
    // إذا كان الرقم يبدأ بـ 0 العادي الخاص بالجزائر (مثال: 0661...) نقوم بتحويله لـ 213
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '213' + cleanPhone.substring(1);
    }

    const url = 'https://restapi.easysendsms.app/v1/rest/sms/send';
    const messageText = `كود التحقق الخاص بك لمنصة واجدة هو: ${otpCode}. لا تشارك هذا الكود مع أحد حفاظاً على أمن حسابك.`;

    // 2. بناء جسم الطلب (Request Body) حسب توثيق EasySendSMS الرسمي
    const requestData = {
        from: process.env.EASYSEND_SENDER || 'WAJDA', // اسم المرسل (الحد الأقصى 11 حرف)
        to: cleanPhone,                              // رقم المستلم الدولي
        text: messageText,                           // محتوى الرسالة
        type: 1                                      // 1 تعني Unicode لتدعم الحروف العربية بسلام
    };

    console.log(`📡 [EasySendSMS Dispatch]: Preparing to send OTP to [${cleanPhone}]...`);

    try {
        const response = await axios.post(url, requestData, {
            headers: {
                'apikey': process.env.EASYSEND_API_KEY, // مفتاح المصادقة في الـ Headers
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 10000 // وقت انتهاء الطلب (10 ثواني كحد أقصى)
        });

        // 3. فحص نجاح العملية والـ Logs
        if (response.data && response.status === 200) {
            console.log(`✅ [EasySendSMS Success]: OTP sent to ${cleanPhone}. Response Data:`, JSON.stringify(response.data));
            return { success: true, data: response.data };
        } else {
            console.error(`❌ [EasySendSMS Failed]: Server accepted request but returned unexpected status: ${response.status}`);
            return { success: false, error: 'Unexpected response layout' };
        }

    } catch (error) {
        // طباعة تفاصيل الخطأ البرمجي المرتد من السيرفر فوراً
        console.error('❌ [EasySendSMS Fatal Error]: Failed to connect to SMS Gateway.');
        if (error.response) {
            console.error('📋 Error Details:', JSON.stringify(error.response.data));
        } else {
            console.error('📋 Message:', error.message);
        }
        return { success: false, error: error.message };
    }
};

module.exports = { sendWajdaOTP };