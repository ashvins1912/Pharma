import React, { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

const CONTEXT_HELP_DATA = {
  storefront: {
    en: {
      title: "💡 Storefront Guidance: Searching & Ordering Medicines",
      tips: [
        "Type brand names (e.g. Paracetamol, Amoxicillin) or generic chemical compositions in the search bar.",
        "Check live stock counts per branch and view generic substitute recommendations.",
        "For Rx Only medicines, attach doctor prescription or request pharmacist verification."
      ]
    },
    hi: {
      title: "💡 स्टोर गाइड: दवाइयां खोजना और ऑर्डर करना",
      tips: [
        "खोज पट्टी में दवा का नाम या जेनेरिक कंपोजिशन दर्ज करें।",
        "शाखा वार लाइव स्टॉक और जेनेरिक विकल्प देखें।",
        "Rx आवश्यक दवाओं के लिए डॉक्टर का पर्चा अपलोड करें।"
      ]
    },
    kn: {
      title: "💡 ಅಂಗಡಿ ಮಾರ್ಗದರ್ಶಿ: ಔಷಧ ಹುಡುಕಾಟ ಮತ್ತು ಆರ್ಡರ್",
      tips: [
        "ಔಷಧದ ಹೆಸರು ಅಥವಾ ಸಂಯೋಜನೆಯನ್ನು ಹುಡುಕಿ.",
        "ಲೈವ್ ಸ್ಟಾಕ್ ಪರಿಶೀಲಿಸಿ ಮತ್ತು ವೈದ್ಯರ ಚೀಟಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ."
      ]
    },
    bn: {
      title: "💡 স্টোর নির্দেশিকা: ওষুধ খোঁজা ও অর্ডার",
      tips: [
        "সার্চবারে ওষুধের নাম লিখুন এবং লাইভ স্টক পরীক্ষা করুন।",
        "প্রয়োজনে ডাক্তারের প্রেসক্রিপশন আপলোড করুন।"
      ]
    },
    te: {
      title: "💡 స్టోర్ మార్గదర్శి: మందుల శోధన & ఆర్డర్",
      tips: [
        "సెర్చ్ బార్‌లో మందు పేరు వెతకండి మరియు లైవ్ స్టಾక్ చూడండి.",
        "ప్రిస్క్రిప్షన్ అవసరమైన మందులకు అప్‌లోడ్ చేయండి."
      ]
    }
  },
  requests: {
    en: {
      title: "📄 Prescription Upload & Proposal Guidelines",
      tips: [
        "Upload a clear photo of your doctor's prescription with duration.",
        "Licensed pharmacists review your prescription and map verified medicine items.",
        "Receive a digital price proposal. Accept proposal to convert directly into a confirmed order."
      ]
    },
    hi: {
      title: "📄 पर्चा अपलोड और प्रस्ताव निर्देश",
      tips: [
        "डॉक्टर के पर्चे की स्पष्ट तस्वीर अपलोड करें।",
        "फार्मासिस्ट पर्चा जांचकर आपको मूल्य प्रस्ताव भेजेंगे।",
        "प्रस्ताव स्वीकार करके सीधे ऑर्डर में बदलें।"
      ]
    },
    kn: {
      title: "📄 ವೈದ್ಯರ ಚೀಟಿ ಅಪ್‌ಲೋಡ್ ಮಾರ್ಗದರ್ಶಿ",
      tips: [
        "ವೈದ್ಯರ ಚೀಟಿಯ ಸ್ಪಷ್ಟ ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.",
        "ಫಾರ್ಮಸಿಸ್ಟ್ ಪ್ರಸ್ತಾವನೆ ಕಳುಹಿಸಿದ ನಂತರ ಅದನ್ನು ಆರ್ಡರ್ ಆಗಿ ಪರಿವರ್ತಿಸಿ."
      ]
    },
    bn: {
      title: "📄 প্রেসক্রিপশন নির্দেশিকা",
      tips: [
        "ডাক্তারের প্রেসক্রিপশন আপলোড করুন এবং ফার্মেসির প্রস্তাব গ্রহণ করুন।"
      ]
    },
    te: {
      title: "📄 ప్రిస్క్రిప్షన్ అప్‌లోడ్ మార్గదర్శి",
      tips: [
        "డాక్టర్ ప్రిస్క్రిప్షన్ అప్‌లోడ్ చేసి డిజిటల్ ప్రతిపాదనను ఆమోదించండి."
      ]
    }
  },
  checkout: {
    en: {
      title: "💳 Checkout & Delivery Location Help",
      tips: [
        "Select your saved delivery address or enter new address details with pin code.",
        "Add optional GPS drop-off coordinates for pinpoint delivery location.",
        "Confirm Cash on Delivery (COD) payment method."
      ]
    },
    hi: {
      title: "💳 चेकआउट और डिलीवरी पता सहायता",
      tips: [
        "अपना सहेजा गया डिलीवरी पता चुनें या नया पता दर्ज करें।",
        "सटीक डिलीवरी के लिए जीपीएस लोकेशन जोड़ें।",
        "कैश ऑन डिलीवरी (COD) का चयन करें।"
      ]
    },
    kn: {
      title: "💳 ಚೆಕ್‌ಔಟ್ ಮತ್ತು ಡೆಲಿವರಿ ಸಹಾಯ",
      tips: [
        "ಡೆಲಿವರಿ ವಿಳಾಸ ಆಯ್ಕೆಮಾಡಿ ಮತ್ತು ಕ್ಯಾಶ್ ಆನ್ ಡೆಲಿವರಿ (COD) ಖಚಿತಪಡಿಸಿ."
      ]
    },
    bn: {
      title: "💳 চেকআউট এবং ডেলিভারি ঠিকানা সহায়তা",
      tips: [
        "ডেলিভারি ঠিকানা নির্বাচন করুন এবং ক্যাশ অন ডেলিভারি নিশ্চিত করুন।"
      ]
    },
    te: {
      title: "💳 చెక్‌అవుట్ & డెలివరీ చిరునామా సహాయం",
      tips: [
        "డెలివరీ చిరునామా ఎంచుకుని క్యాష్ ఆన్ డెలివరీ ని ధృవీకరించండి."
      ]
    }
  },
  order_tracking: {
    en: {
      title: "🛵 Live Courier Tracking & Delivery OTP Verification",
      tips: [
        "Track real-time delivery status: Processing ➔ Ready ➔ Dispatched ➔ Delivered.",
        "View assigned courier rider name and direct phone number.",
        "Receive automated WhatsApp delivery alerts and provide your 4-digit OTP only at physical handover."
      ]
    },
    hi: {
      title: "🛵 लाइव कूरियर ट्रैकिंग और 4-अंकीय ओटीपी सुरक्षा",
      tips: [
        "रियल-टाइम डिलीवरी स्थिति देखें: प्रोसेसिंग ➔ डिस्पैच ➔ डिलीवर्ड।",
        "राइडर का नाम और मोबाइल नंबर देखें।",
        "सामान मिलने पर ही 4-अंकीय ओटीपी दें।"
      ]
    },
    kn: {
      title: "🛵 ಲೈವ್ ಟ್ರ್ಯಾಕಿಂಗ್ ಮತ್ತು OTP ಸಹಾಯ",
      tips: [
        "ಆರ್ಡರ್ ಡಿಸ್ಪ್ಯಾಚ್ ಆದಾಗ 4-ಅಂಕಿಯ OTP ನೀಡಿ ಡೆಲಿವರಿ ಸ್ವೀಕರಿಸಿ."
      ]
    },
    bn: {
      title: "🛵 লাইভ ট্র্যাকিং এবং ৪-সংখ্যার OTP",
      tips: [
        "ডেলিভারির সময় প্রাপ্ত ৪-সংখ্যার OTP রাইডারকে দিন।"
      ]
    },
    te: {
      title: "🛵 లైవ్ ట్రాకింగ్ & 4-అంకెల OTP సహాయం",
      tips: [
        "డెలివరీ సమయంలో 4-అంకెల OTP ని రైడర్‌కు అందించండి."
      ]
    }
  },
  addresses: {
    en: {
      title: "🏠 Saved Addresses & GPS Coordinates Directory",
      tips: [
        "Manage primary home, office, and family member drop-off locations.",
        "Include pincode, landmark, and optional latitude/longitude coordinates.",
        "Set default address for 1-click checkout."
      ]
    },
    hi: {
      title: "🏠 सहेजे गए पते और जीपीएस लोकेटर निर्देशिका",
      tips: [
        "घर, कार्यालय और परिजनों के डिलीवरी पते सहेजें।",
        "पिन कोड और लैंडमार्क दर्ज करें।"
      ]
    },
    kn: {
      title: "🏠 ಉಳಿಸಿದ ವಿಳಾಸಗಳ ನಿರ್ವಹಣೆ",
      tips: [
        "ಡೆಲಿವರಿ ವಿಳಾಸಗಳನ್ನು ನಿರ್ವಹಿಸಿ ಮತ್ತು ಪಿನ್‌ಕೋಡ್ ನಮೂದಿಸಿ."
      ]
    },
    bn: {
      title: "🏠 সেভ করা ঠিকানা ডিরেক্টরি",
      tips: [
        "ডেলিভারি ঠিকানা এবং পিনকোড সেভ করুন।"
      ]
    },
    te: {
      title: "🏠 సేవ్ చేసిన చిరునామాలు",
      tips: [
        "డెలివరీ చిరునామాలను మరియు పిన్‌కోడ్ నిర్వహించండి."
      ]
    }
  },
  admin: {
    en: {
      title: "⚡ Pharmacy Operations & Dispatch Command Center",
      tips: [
        "Move order cards across stages: Pending Review ➔ Approved ➔ Ready to Dispatch ➔ Dispatched ➔ Delivered.",
        "Connect WhatsApp QR code to dispatch automated customer delivery updates and OTPs.",
        "Trigger the Automated Dispatch Engine to auto-assign orders based on GPS rider proximity."
      ]
    },
    hi: {
      title: "⚡ फ़ार्मेसी ऑपरेशंस एवं डिस्पैच कमांड सेंटर",
      tips: [
        "कानबन बोर्ड पर ऑर्डर चरण बदलें: रिव्यू ➔ अप्रूव्ड ➔ रेडी ➔ डिस्पैच ➔ डिलीवर्ड।",
        "व्हाट्सएप क्यूआर कोड स्कैन करके स्वचालित ओटीपी सूचनाएं भेजें।",
        "जीपीएस दूरी के आधार पर ऑटो-डिस्पैच इंजन चलाएं।"
      ]
    },
    kn: {
      title: "⚡ ಫಾರ್ಮಸಿ ಕಾರ್ಯಾಚರಣೆ ಮತ್ತು ಡಿಸ್ಪ್ಯಾಚ್ ಕೇಂದ್ರ",
      tips: [
        "ಆರ್ಡರ್‌ಗಳನ್ನು ಹಂತ ಹಂತವಾಗಿ (Approved ➔ Ready ➔ Dispatched ➔ Delivered) ನಿರ್ವಹಿಸಿ."
      ]
    },
    bn: {
      title: "⚡ ফার্মেসি পরিচালনা ও ডিসপ্যাচ",
      tips: [
        "কানবান বোর্ডে অর্ডার প্রসেস করুন এবং রাইডার অ্যাসাইন করুন।"
      ]
    },
    te: {
      title: "⚡ ఫార్మసీ ఆపరేషన్స్ & డిస్పాచ్ సెంటర్",
      tips: [
        "ఆర్డర్ స్థాయిలను మార్చండి మరియు రైడర్లను కేటాయించండి."
      ]
    }
  },
  rider_terminal: {
    en: {
      title: "📱 Delivery Rider Dispatch Terminal & OTP Handover",
      tips: [
        "Set status to 'Available' to receive instant delivery assignment alerts.",
        "Accept active order to initiate GPS route telemetry tracking.",
        "Request customer's 4-digit OTP at doorstep and enter it into terminal to confirm delivery."
      ]
    },
    hi: {
      title: "📱 डिलीवरी राइडर टर्मिनल और ओटीपी सत्यापन",
      tips: [
        "ऑर्डर असाइनमेंट प्राप्त करने के लिए स्थिति 'Available' पर सेट करें।",
        "डोरस्टेप पर ग्राहक से 4-अंकीय ओटीपी लेकर दर्ज करें और डिलीवरी पूरी करें।"
      ]
    },
    kn: {
      title: "📱 ಡೆಲಿವರಿ ರೈಡರ್ ಟರ್ಮಿನಲ್",
      tips: [
        "ಆರ್ಡರ್ ಸ್ವೀಕರಿಸಿ ಮತ್ತು 4-ಅಂಕಿಯ OTP ಪರಿಶೀಲಿಸಿ ಡೆಲಿವರಿ ಪೂರ್ಣಗೊಳಿಸಿ."
      ]
    },
    bn: {
      title: "📱 ডেলিভারি রাইডার টার্মিনাল",
      tips: [
        "গ্রাহকের ৪-সংখ্যার OTP যাচাই করে ডেলিভারি সম্পন্ন করুন।"
      ]
    },
    te: {
      title: "📱 డెలివరీ రైడర్ టెర్మినల్",
      tips: [
        "కస్టమర్ 4-అంకెల OTP ని నమూదు చేసి డెలివరీ పూర్తి చేయండి."
      ]
    }
  },
  platform_tenants: {
    en: {
      title: "🏢 Regional Pharmacy Directory & Access Governance",
      tips: [
        "Onboard regional pharmacy tenants with legal credentials, timezone, and currency.",
        "Configure branch isolation boundaries and delegate tenant admin credentials.",
        "Issue cryptographic invitation links to vendor partners."
      ]
    },
    hi: {
      title: "🏢 क्षेत्रीय फार्मेसी निर्देशिका और एक्सेस गवर्नेंस",
      tips: [
        "क्षेत्रीय फार्मेसी टेनेंट्स को ऑनबोर्ड करें और एक्सेस सीमाएं निर्धारित करें।",
        "वेंडर पार्टनर्स को ऑनबोर्डिंग लिंक भेजें।"
      ]
    },
    kn: {
      title: "🏢 ಪ್ರಾದೇಶಿಕ ಫಾರ್ಮಸಿ ನಿರ್ವಹಣೆ",
      tips: [
        "ಫಾರ್ಮಸಿ ಟೆನೆಂಟ್‌ಗಳನ್ನು ನೋಂದಾಯಿಸಿ ಮತ್ತು ಪ್ರವೇಶಾಧಿಕಾರ ನಿರ್ವಹಿಸಿ."
      ]
    },
    bn: {
      title: "🏢 আঞ্চলিক ফার্মেসি ডিরেক্টরি",
      tips: [
        "ফার্মেসি টেন্যান্ট এবং পারমিশন পরিচালনা করুন।"
      ]
    },
    te: {
      title: "🏢 రీజినల్ ఫార్మసీ డైరెక్టరీ",
      tips: [
        "ఫార్మసీ టెనెంట్లను మరియు అనుమతులను నిర్వహించండి."
      ]
    }
  }
};

export default function ContextualHelpBanner({ topic = 'storefront', className = '' }) {
  const { language, t } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const topicData = CONTEXT_HELP_DATA[topic] || CONTEXT_HELP_DATA.storefront;
  const langHelp = topicData[language] || topicData.en;

  return (
    <div className={`rounded-2xl border border-blue-200/80 bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-slate-50 p-3.5 sm:p-4 text-slate-800 shadow-xs transition-all ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-black text-xs text-blue-900">
          <span>{langHelp.title}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="text-[11px] font-bold text-blue-700 hover:text-blue-900 px-2 py-0.5 rounded-lg bg-blue-100/60 hover:bg-blue-100 transition cursor-pointer"
          >
            {collapsed ? `${t('show')} ▾` : `${t('hide')} ▴`}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-slate-400 hover:text-slate-600 text-xs px-1.5 py-0.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
            title="Dismiss help banner"
          >
            ✕
          </button>
        </div>
      </div>

      {!collapsed && (
        <ul className="mt-2.5 space-y-1.5 text-[11px] text-slate-700 font-medium border-t border-blue-100/80 pt-2.5">
          {langHelp.tips.map((tip, idx) => (
            <li key={idx} className="flex items-start gap-1.5 leading-relaxed">
              <span className="text-blue-600 font-bold shrink-0">•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
