import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';

const TOUR_STEPS_DATA = {
  en: [
    {
      title: "Welcome to QuickMeds Rx! 👋",
      content: "Your complete healthcare & pharmacy management platform. Take a quick 1-minute tour to discover key features.",
      targetSelector: "header",
      position: "bottom"
    },
    {
      title: "1. Search Medicines & Real-Time Stock 🔍",
      content: "Search 1,000+ medicines by Brand Name, Generic Composition, or Therapeutic Class. View instant stock counts and generic substitutes.",
      targetSelector: "input[type='search'], input[placeholder*='search' i], .pharma-storefront",
      position: "bottom"
    },
    {
      title: "2. Prescription Upload & Custom Requests 📄",
      content: "Upload doctor prescriptions or request special medicines. Licensed pharmacists review your prescription and send formal price proposals.",
      targetSelector: "button:has(span:contains('Requests')), nav button:nth-child(2)",
      position: "bottom"
    },
    {
      title: "3. Cash on Delivery & Order Checkout 💳",
      content: "Add medicines to cart, specify drop-off GPS coordinates, and place Cash on Delivery (COD) orders seamlessly.",
      targetSelector: "button[aria-label*='Cart' i], .quickmeds-actions-group",
      position: "bottom"
    },
    {
      title: "4. Live Tracking & 4-Digit Delivery OTP 🛵",
      content: "Track active courier deliveries in real-time. Receive automated WhatsApp updates and share your 4-digit OTP only at handover.",
      targetSelector: "button:has(span:contains('Orders')), nav button:nth-child(1)",
      position: "bottom"
    },
    {
      title: "5. Pharmacy Operations & Dispatch Center 🏥",
      content: "Pharmacy Admins can access Kanban order management, rider dispatch engines, stock batch matrices, and WhatsApp QR gateways.",
      targetSelector: ".app-header__nav-item",
      position: "bottom"
    },
    {
      title: "6. Multi-Language Choice 🌐",
      content: "Switch seamlessly between English, Hindi (हिन्दी), Kannada (ಕನ್ನಡ), Bengali (বাংলা), and Telugu (తెలుగు) at any time!",
      targetSelector: ".app-header__language-select, select[aria-label*='Language' i]",
      position: "bottom"
    }
  ],
  hi: [
    {
      title: "QuickMeds Rx में आपका स्वागत है! 👋",
      titleHi: "स्वागत है",
      content: "स्वास्थ्य सेवा और फ़ार्मेसी प्रबंधन प्लेटफ़ॉर्म। मुख्य विशेषताओं को जानने के लिए 1 मिनट का दौरा करें।",
      position: "bottom"
    },
    {
      title: "1. दवाइयां खोजना और लाइव स्टॉक 🔍",
      content: "ब्रांड नाम या जेनेरिक कंपोजिशन द्वारा 1,000+ दवाइयां खोजें। वास्तविक समय में स्टॉक और विकल्प देखें।",
      position: "bottom"
    },
    {
      title: "2. प्रिस्क्रिप्शन अपलोड और विशेष अनुरोध 📄",
      content: "डॉक्टर का पर्चा अपलोड करें। फार्मासिस्ट जांच के बाद आपको डिजिटल मूल्य प्रस्ताव भेजेंगे।",
      position: "bottom"
    },
    {
      title: "3. कैश ऑन डिलीवरी और आसान चेकआउट 💳",
      content: "दवाइयां कार्ट में जोड़ें और कैश ऑन डिलीवरी (COD) का चयन करके ऑर्डर पूरा करें।",
      position: "bottom"
    },
    {
      title: "4. लाइव कूरियर ट्रैकिंग और 4-अंकीय ओटीपी 🛵",
      content: "वास्तविक समय में कूरियर ट्रैक करें। राइडर को सामान मिलने पर ही 4-अंकीय सुरक्षा ओटीपी दें।",
      position: "bottom"
    },
    {
      title: "5. बहुभाषी चयन (Multi-Language) 🌐",
      content: "किसी भी समय अंग्रेजी, हिन्दी, कन्नड़, बंगाली और तेलुगु में भाषा बदलें!",
      position: "bottom"
    }
  ],
  kn: [
    {
      title: "QuickMeds Rx ಗೆ ಸ್ವಾಗತ! 👋",
      content: "ನಿಮ್ಮ ಫಾರ್ಮಸಿ ನಿರ್ವಹಣಾ ಪ್ಲಾಟ್‌ಫಾರ್ಮ್. ಮುಖ್ಯ ವೈಶಿಷ್ಟ್ಯಗಳನ್ನು ತಿಳಿಯಲು 1 ನಿಮಿಷದ ಪ್ರವಾಸ ಮಾಡಿ.",
      position: "bottom"
    },
    {
      title: "1. ಔಷಧ ಹುಡುಕಾಟ ಮತ್ತು ಲೈವ್ ಸ್ಟಾಕ್ 🔍",
      content: "ಬ್ರಾಂಡ್ ಹೆಸರು ಅಥವಾ ಸಂಯೋಜನೆಯ ಮೂಲಕ ಔಷಧಗಳನ್ನು ಹುಡುಕಿ ಮತ್ತು ನೇರ ಲಭ್ಯತೆ ಪರಿಶೀಲಿಸಿ.",
      position: "bottom"
    },
    {
      title: "2. ವೈದ್ಯರ ಚೀಟಿ (Prescription) ಅಪ್‌ಲೋಡ್ 📄",
      content: "ವೈದ್ಯರ ಚೀಟಿ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ಮತ್ತು ಫಾರ್ಮಸಿಸ್ಟ್‌ಗಳಿಂದ ಬೆಲೆ ಪ್ರಸ್ತಾವನೆಗಳನ್ನು ಸ್ವೀಕರಿಸಿ.",
      position: "bottom"
    },
    {
      title: "3. ಲೈವ್ ಟ್ರ್ಯಾಕಿಂಗ್ ಮತ್ತು 4-ಅಂಕಿಯ OTP 🛵",
      content: "ಆರ್ಡರ್ ಸ್ವೀಕರಿಸುವಾಗ 4-ಅಂಕಿಯ OTP ನೀಡಿ ಡೆಲಿವರಿ ಸ್ವೀಕರಿಸಿ.",
      position: "bottom"
    },
    {
      title: "4. ಬಹುಭಾಷಾ ಆಯ್ಕೆ 🌐",
      content: "ಇಂಗ್ಲಿಷ್, ಹಿಂದಿ, ಕನ್ನಡ, ಬಂಗಾಳಿ ಮತ್ತು ತೆಲುಗು ಭಾಷೆಗಳ ನಡುವೆ ಬದಲಾಯಿಸಿ!",
      position: "bottom"
    }
  ],
  bn: [
    {
      title: "QuickMeds Rx-এ স্বাগতম! 👋",
      content: "আপনার হেলথকেয়ার ও ফার্মেসি প্ল্যাটফর্ম। প্রধান বৈশিষ্ট্যগুলি জানতে ১ মিনিটের গাইড ট্যুর নিন।",
      position: "bottom"
    },
    {
      title: "১. ওষুধ অনুসন্ধান ও স্টক পরীক্ষা 🔍",
      content: "১০০০+ ওষুধ খুঁজুন এবং লাইভ স্টক ও বিকল্প ওষুধ দেখুন।",
      position: "bottom"
    },
    {
      title: "২. প্রেসক্রিপশন আপলোড এবং অর্ডার 📄",
      content: "ডাক্তারের প্রেসক্রিপশন আপলোড করুন এবং ফার্মেসির প্রস্তাব গ্রহণ করুন।",
      position: "bottom"
    },
    {
      title: "৩. লাইভ ট্র্যাকিং এবং ৪-সংখ্যার OTP 🛵",
      content: "ডেলিভারির সময় প্রাপ্ত ৪-সংখ্যার সিকিউরিটি OTP রাইডারকে দিন।",
      position: "bottom"
    },
    {
      title: "৪. বহুভাষিক নির্বাচন 🌐",
      content: "যেকোনো সময় ইংরেজি, হিন্দি, কন্নড়, বাংলা এবং তেলেগু ভাষার মধ্যে পরিবর্তন করুন!",
      position: "bottom"
    }
  ],
  te: [
    {
      title: "QuickMeds Rx కి స్వాగతం! 👋",
      content: "మీ హెల్త్‌కేర్ మరియు ఫార్మసీ మేనేజ్‌మెంట్ ప్లాట్‌ఫారమ్. ప్రధాన ఫీచర్లను తెలుసుకోవడానికి 1 నిమిషం టూర్ చేయండి.",
      position: "bottom"
    },
    {
      title: "1. మందుల శోధన మరియు లైవ్ స్టాక్ 🔍",
      content: "1,000+ మందులను వెతకండి మరియు రియల్-టైమ్ స్టాక్ చూడండి.",
      position: "bottom"
    },
    {
      title: "2. ప్రిస్క్రిప్షన్ అప్‌లోడ్ మరియు ఆర్డర్ 📄",
      content: "డాక్టర్ ప్రిస్క్రిప్షన్ అప్‌లోడ్ చేసి డిజిటల్ ధర ప్రతిపాదనలను పొందండి.",
      position: "bottom"
    },
    {
      title: "3. లైవ్ ట్రాకింగ్ మరియు 4-అంకెల OTP 🛵",
      content: "డెలివరీ సమయంలో 4-అంకెల సురక్షిత OTP ఉపయోగించండి.",
      position: "bottom"
    },
    {
      title: "4. బహుభాషా ఎంపిక 🌐",
      content: "ఏ సమయంలోనైనా ఇంగ్లీష్, హిందీ, కన్నడ, బెంగాలీ మరియు తెలుగు భాషల్లోకి మారండి!",
      position: "bottom"
    }
  ]
};

export default function InteractiveProductTour({ isOpen, onClose }) {
  const { language, t } = useLanguage();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const steps = TOUR_STEPS_DATA[language] || TOUR_STEPS_DATA.en;
  const currentStep = steps[currentStepIndex] || steps[0];
  const totalSteps = steps.length;

  useEffect(() => {
    if (isOpen) setCurrentStepIndex(0);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center p-4 modal-overlay animate-fade-in pointer-events-auto overscroll-none"
      aria-modal="true"
      role="dialog"
      aria-labelledby="tour-step-title"
    >
      {/* Semi-transparent Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs touch-none"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Tour Dialog Card */}
      <div className="relative z-10 m-auto w-full max-w-md overflow-hidden rounded-3xl border border-blue-200 bg-white p-6 shadow-2xl space-y-4 animate-slide-up">
        
        {/* Step Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-blue-600">
            <span>✨ Guided Product Tour</span>
            <span>Step {currentStepIndex + 1} of {totalSteps}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300 ease-out"
              style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Step Content */}
        <div className="space-y-2 pt-2">
          <h3 id="tour-step-title" className="text-base sm:text-lg font-black text-slate-900 leading-tight">
            {currentStep.title}
          </h3>
          <p className="text-xs text-slate-600 font-medium leading-relaxed">
            {currentStep.content}
          </p>
        </div>

        {/* Multi-language indication pill */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px] text-slate-400 font-semibold">
          <span className="flex items-center gap-1 text-slate-500">
            🌐 Active Language: <strong className="text-slate-800 uppercase">{language}</strong>
          </span>
          <span>Press Esc or click backdrop to exit</span>
        </div>

        {/* Control Action Buttons */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 transition cursor-pointer"
          >
            Skip Tour
          </button>

          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold rounded-xl transition cursor-pointer"
              >
                Back
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl shadow-md shadow-blue-500/20 transition cursor-pointer"
            >
              {currentStepIndex === totalSteps - 1 ? 'Finish Tour 🎉' : 'Next Step ➔'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
