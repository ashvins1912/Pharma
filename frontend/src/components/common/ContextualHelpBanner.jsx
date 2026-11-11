import React, { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';

const CONTEXT_HELP_DATA = {
  storefront: {
    en: {
      title: "💡 Need help placing a medicine order?",
      tips: [
        "Type medicine brand name or generic chemical composition in the search bar.",
        "Check live inventory stock count and active branch location.",
        "If a prescription is required, upload your prescription image at checkout or under Medicine Requests."
      ]
    },
    hi: {
      title: "💡 दवा ऑर्डर करने में सहायता चाहिए?",
      tips: [
        "खोज पट्टी में दवा का नाम या जेनेरिक कंपोजिशन टाइप करें।",
        "लाइव स्टॉक और नजदीकी शाखा उपलब्धता देखें।",
        "यदि पर्चा आवश्यक है, तो पर्चा अपलोड करें या अनुरोध भेजें।"
      ]
    },
    kn: {
      title: "💡 ಆರ್ಡರ್ ಮಾಡಲು ಸಹಾಯ ಬೇಕೇ?",
      tips: [
        "ಔಷಧದ ಹೆಸರು ಅಥವಾ ಸಂಯೋಜನೆಯನ್ನು ಹುಡುಕಿ.",
        "ಲೈವ್ ಸ್ಟಾಕ್ ಪರಿಶೀಲಿಸಿ ಮತ್ತು ವೈದ್ಯರ ಚೀಟಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ."
      ]
    },
    bn: {
      title: "💡 ওষুধ অর্ডার করতে সাহায্য চান?",
      tips: [
        "সার্চবারে ওষুধের নাম লিখুন এবং লাইভ স্টক পরীক্ষা করুন।",
        "প্রয়োজনে ডাক্তারের প্রেসক্রিপশন আপলোড করুন।"
      ]
    },
    te: {
      title: "💡 మందులు ఆర్డర్ చేయడంలో సహాయం కావాలా?",
      tips: [
        "సెర్చ్ బార్‌లో మందు పేరు లేదా కాంబినేషన్ వెతకండి.",
        "లైవ్ స్టాక్ చూసి ప్రిస్క్రిప్షన్ అప్‌లోడ్ చేయండి."
      ]
    }
  },
  requests: {
    en: {
      title: "📄 Prescription Upload & Proposal Guidelines",
      tips: [
        "Upload a clear photo of your doctor's prescription.",
        "Licensed pharmacists review your prescription and map exact medicines.",
        "You will receive a digital proposal with total price. Click 'Approve Proposal' to convert it into a confirmed order."
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
  admin: {
    en: {
      title: "⚡ Pharmacy Operations & Dispatch Command Center",
      tips: [
        "Move orders along the Kanban board: Pending Review ➔ Approved ➔ Ready to Dispatch ➔ Dispatched ➔ Delivered.",
        "Use the WhatsApp Connect button to scan QR code and issue automated OTP delivery notifications.",
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
  }
};

export default function ContextualHelpBanner({ topic = 'storefront', className = '' }) {
  const { language } = useLanguage();
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
            {collapsed ? 'Show Tips ▾' : 'Hide Tips ▴'}
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
