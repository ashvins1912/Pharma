import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../context/LanguageContext';

const GUIDE_DATA = {
  en: {
    title: "QuickMeds Rx — Application Guide & Manual",
    subtitle: "Complete interactive reference for Customers, Pharmacy Managers, Delivery Riders, and Platform Super Admins.",
    searchPlaceholder: "Search guide topics (e.g., OTP, Prescription, Dispatch, Rider)...",
    tabs: {
      customer: "🛒 Customer Workflow",
      pharmacy: "🏥 Pharmacy Operations",
      rider: "🛵 Delivery Rider",
      superadmin: "🛡️ Platform & Governance"
    },
    sections: {
      customer: [
        {
          title: "1. Searching Medicines & Stock Availability",
          icon: "🔍",
          steps: [
            "Use the top search bar to search medicines by Brand Name, Generic Composition, or Therapeutic Class.",
            "View real-time inventory counts and active branch availability.",
            "If an item is out of stock, click 'Join Waitlist' or request generic substitutes."
          ]
        },
        {
          title: "2. Prescription Upload & Special Requests",
          icon: "📄",
          steps: [
            "Click 'Upload Prescription' or open 'Medicine Requests' from the header.",
            "Upload clear images of doctor prescriptions along with prescribed duration.",
            "Pharmacists review your prescription, match exact medicines, and send formal proposals.",
            "Review prices, accept proposals, and convert them directly into confirmed orders."
          ]
        },
        {
          title: "3. Checkout, Address & Cash on Delivery (COD)",
          icon: "💳",
          steps: [
            "Add medicines to cart and proceed to checkout.",
            "Select or add delivery address with pin code and optional GPS drop-off coordinates.",
            "Confirm Cash on Delivery (COD) payment method."
          ]
        },
        {
          title: "4. Live Courier Tracking & 4-Digit Delivery OTP",
          icon: "🛵",
          steps: [
            "Track active orders in real-time under 'My Orders & Live Tracking'.",
            "When your order status moves to 'Dispatched / Out for Delivery', a secure 4-digit OTP is issued.",
            "Receive instant WhatsApp delivery alerts with courier contact details.",
            "Share the 4-digit OTP with the delivery rider only at handover to complete delivery."
          ]
        }
      ],
      pharmacy: [
        {
          title: "1. Operations Dashboard & Kanban Board",
          icon: "📊",
          steps: [
            "Access the Admin Operations Dashboard to monitor live orders across all fulfillment stages.",
            "Move orders through states: Pending Review ➔ Approved ➔ Ready to Dispatch ➔ Dispatched ➔ Delivered.",
            "Filter orders by branch, date range, or payment status."
          ]
        },
        {
          title: "2. Prescription Matching & Review Queue",
          icon: "💊",
          steps: [
            "Review customer prescription uploads in the Medicine Match Queue.",
            "Search master medicine catalog and map customer requests to verified inventory.",
            "Issue digital price proposals to customers."
          ]
        },
        {
          title: "3. Automated Rider Assignment Engine",
          icon: "⚡",
          steps: [
            "Assign deliveries manually or trigger the Automated Dispatch Engine.",
            "The system evaluates nearby available riders, GPS proximity, and active workload to auto-assign orders."
          ]
        },
        {
          title: "4. WhatsApp Gateway & Multi-Tenant Inventory",
          icon: "📲",
          steps: [
            "Connect WhatsApp QR code in the command center to send automated order status updates and delivery OTPs.",
            "Manage stock batches, expiry dates, MRP, and discounted selling prices."
          ]
        }
      ],
      rider: [
        {
          title: "1. Rider Dispatch Terminal & Active Orders",
          icon: "📱",
          steps: [
            "Open the Rider Terminal view and set operational status to 'Available'.",
            "Receive instant delivery assignment notifications with customer delivery location.",
            "Accept delivery to navigate active route."
          ]
        },
        {
          title: "2. GPS Telemetry & Handover Verification",
          icon: "📍",
          steps: [
            "Real-time GPS telemetry updates pharmacy dispatch center with live rider coordinates.",
            "Upon reaching customer location, request the 4-digit customer delivery OTP.",
            "Input OTP in Rider Terminal to verify identity and mark order as 'Delivered'."
          ]
        }
      ],
      superadmin: [
        {
          title: "1. Multi-Tenant Regional Pharmacy Directory",
          icon: "🏢",
          steps: [
            "Onboard regional pharmacy tenants with legal name, contact email, timezone, and currency.",
            "Configure branch isolation boundaries and issue tenant administrator credentials.",
            "Monitor tenant operational status (Active / Suspended / Pending)."
          ]
        },
        {
          title: "2. Vendor Partner Invitations & Onboarding",
          icon: "✉️",
          steps: [
            "Issue single-use cryptographic invitation links to vendor partners.",
            "Track vendor onboarding status and verify company credentials."
          ]
        },
        {
          title: "3. RBAC, System Telemetry & Feature Availability",
          icon: "🛡️",
          steps: [
            "Trigger live RBAC permission audits across all roles (Super Admin, Tenant Admin, Staff, Rider, Customer).",
            "Probe microservices health and microsecond response latency."
          ]
        }
      ]
    }
  },
  hi: {
    title: "QuickMeds Rx — संपूर्ण एप्लिकेशन गाइड और मैनुअल",
    subtitle: "ग्राहकों, फार्मेसी प्रबंधकों, डिलीवरी राइडर्स और सुपर एडमिन के लिए बहुभाषी निर्देश।",
    searchPlaceholder: "विषय खोजें (जैसे: ओटीपी, पर्चा, डिस्पैच, राइडर)...",
    tabs: {
      customer: "🛒 ग्राहक प्रक्रिया",
      pharmacy: "🏥 फार्मेसी संचालन",
      rider: "🛵 डिलीवरी राइडर",
      superadmin: "🛡️ प्लेटफॉर्म गवर्नेंस"
    },
    sections: {
      customer: [
        {
          title: "1. दवाइयां खोजना और उपलब्धता देखना",
          icon: "🔍",
          steps: [
            "ब्रांड नाम, जेनेरिक कंपोजिशन या थेराप्यूटिक श्रेणी द्वारा दवाइयां खोजें।",
            "वास्तविक समय (Real-time) स्टॉक और नजदीकी शाखा उपलब्धता देखें।",
            "यदि दवा अनुपलब्ध है, तो 'वेटलिस्ट' में शामिल हों या विकल्प का अनुरोध करें।"
          ]
        },
        {
          title: "2. डॉक्टर का पर्चा (Prescription) अपलोड करना",
          icon: "📄",
          steps: [
            "हेडर से 'अपलोड प्रिस्क्रिप्शन' या 'दवा अनुरोध' खोलें।",
            "डॉक्टर के पर्चे की स्पष्ट तस्वीर अपलोड करें।",
            "फार्मासिस्ट पर्चे की जांच करेंगे और मूल्य प्रस्ताव (Proposal) भेजेंगे।",
            "प्रस्ताव स्वीकार करें और सीधे ऑर्डर में बदलें।"
          ]
        },
        {
          title: "3. ऑर्डर चेकआउट और कैश ऑन डिलीवरी (COD)",
          icon: "💳",
          steps: [
            "दवाइयां कार्ट में जोड़ें और चेकआउट पर जाएं।",
            "डिलिवरी पता और पिन कोड दर्ज करें।",
            "कैश ऑन डिलीवरी (COD) का चयन करके ऑर्डर पूरा करें।"
          ]
        },
        {
          title: "4. लाइव डिलीवरी ट्रैकिंग और 4-अंकीय ओटीपी",
          icon: "🛵",
          steps: [
            "'माई ऑर्डर्स' में लाइव कूरियर ट्रैकिंग देखें।",
            "ऑर्डर 'डिस्पैच' होने पर 4-अंकीय सुरक्षा ओटीपी प्राप्त होता है।",
            "व्हाट्सएप पर राइडर विवरण और डिलीवरी अपडेट प्राप्त करें।",
            "डिलीवरी राइडर को सामान मिलने पर ही 4-अंकीय ओटीपी दें।"
          ]
        }
      ],
      pharmacy: [
        {
          title: "1. ऑपरेशंस डैशबोर्ड और कानबन बोर्ड",
          icon: "📊",
          steps: [
            "सभी ऑर्डर चरणों को लाइव देखने के लिए एडमिन ऑपरेशंस डैशबोर्ड खोलें।",
            "ऑर्डर स्टेटस: रिव्यू ➔ अप्रूव्ड ➔ रेडी टू डिस्पैच ➔ डिस्पैच ➔ डिलीवर्ड में बदलें।",
            "शाखा और तिथि के अनुसार ऑर्डर फिल्टर करें।"
          ]
        },
        {
          title: "2. पर्चा सत्यापन और दवा मिलान",
          icon: "💊",
          steps: [
            "ग्राहक द्वारा अपलोड किए गए पर्चे की जांच करें।",
            "मास्टर कैटलॉग से सही दवा का मिलान करें और ग्राहक को मूल्य प्रस्ताव भेजें।"
          ]
        },
        {
          title: "3. स्वचालित राइडर असाइनमेंट",
          icon: "⚡",
          steps: [
            "राइडर को मैन्युअल रूप से असाइन करें या स्वचालित डिस्पैच इंजन चलाएं।",
            "सिस्टम नजदीकी राइडर और जीपीएस दूरी के आधार पर ऑटो-असाइन करता है।"
          ]
        },
        {
          title: "4. व्हाट्सएप गेटवे और इन्वेंट्री नियंत्रण",
          icon: "📲",
          steps: [
            "व्हाट्सएप क्यूआर कोड लिंक करके ग्राहकों को स्वचालित ओटीपी और अलर्ट भेजें।",
            "स्टॉक बैच, एक्सपायरी डेट और मूल्य प्रबंधित करें।"
          ]
        }
      ],
      rider: [
        {
          title: "1. राइडर टर्मिनल और ऑर्डर स्वीकार करना",
          icon: "📱",
          steps: [
            "राइडर टर्मिनल खोलें और स्थिति को 'Available' पर सेट करें।",
            "ऑर्डर असाइनमेंट नोटिफिकेशन प्राप्त करें और डिलीवरी स्वीकार करें।"
          ]
        },
        {
          title: "2. जीपीएस ट्रैकिंग और ओटीपी सत्यापन",
          icon: "📍",
          steps: [
            "वास्तविक समय जीपीएस लोकेटर से फार्मेसी को आपकी लोकेशन मिलती रहती है।",
            "ग्राहक के पास पहुंचकर 4-अंकीय ओटीपी मांगें।",
            "टर्मिनल में ओटीपी दर्ज करके ऑर्डर 'Delivered' मार्क करें।"
          ]
        }
      ],
      superadmin: [
        {
          title: "1. मल्टी-टेनेंट फार्मेसी निर्देशिका",
          icon: "🏢",
          steps: [
            "क्षेत्रीय फार्मेसी टेनेंट्स को ऑनबोर्ड करें और एक्सेस सीमाएं निर्धारित करें।",
            "टेनेंट स्थिति (Active / Suspended) प्रबंधित करें।"
          ]
        },
        {
          title: "2. वेंडर पार्टनर आमंत्रण",
          icon: "✉️",
          steps: [
            "वेंडर पार्टनर्स को सिंगल-यूज़ लिंक भेजकर ऑनबोर्ड करें।"
          ]
        },
        {
          title: "3. आरबीएसी (RBAC) और सिस्टम टेलीमेट्री",
          icon: "🛡️",
          steps: [
            "रोल-बेस्ड एक्सेस कंट्रोल का ऑडिट करें और माइक्रोसर्विसेज स्वास्थ्य जांचें।"
          ]
        }
      ]
    }
  },
  kn: {
    title: "QuickMeds Rx — ಸಂಪೂರ್ಣ ಅಪ್ಲಿಕೇಶನ್ ಮಾರ್ಗದರ್ಶಿ",
    subtitle: "ಗ್ರಾಹಕರು, ಫಾರ್ಮಸಿ ಮ್ಯಾನೇಜರ್‌ಗಳು, ಡೆಲಿವರಿ ರೈಡರ್‌ಗಳು ಮತ್ತು ಸೂಪರ್ ಅಡ್ಮಿನ್‌ಗಳಿಗಾಗಿ ಬಹುಭಾಷಾ ಕೈಪಿಡಿ.",
    searchPlaceholder: "ವಿಷಯ ಹುಡುಕಿ (ಉದಾ: OTP, ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್, ಡಿಸ್ಪ್ಯಾಚ್, ರೈಡರ್)...",
    tabs: {
      customer: "🛒 ಗ್ರಾಹಕರ ಪ್ರಕ್ರಿಯೆ",
      pharmacy: "🏥 ಫಾರ್ಮಸಿ ಕಾರ್ಯಾಚರಣೆ",
      rider: "🛵 ಡೆಲಿವರಿ ರೈಡರ್",
      superadmin: "🛡️ ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಆಡಳಿತ"
    },
    sections: {
      customer: [
        {
          title: "1. ಔಷಧ ಹುಡುಕಾಟ ಮತ್ತು ಲಭ್ಯತೆ ಪರಿಶೀಲನೆ",
          icon: "🔍",
          steps: [
            "ಬ್ರಾಂಡ್ ಹೆಸರು ಅಥವಾ ಸಂಯೋಜನೆಯ ಮೂಲಕ ಔಷಧಗಳನ್ನು ಹುಡುಕಿ.",
            "ನೈಜ-ಸಮಯದ (Real-time) ಸ್ಟಾಕ್ ಪರಿಶೀಲಿಸಿ.",
            "ಔಷಧ ಲಭ್ಯವಿಲ್ಲದಿದ್ದರೆ 'ವೇಟ್‌ಲಿಸ್ಟ್' ಸೇರಿ."
          ]
        },
        {
          title: "2. ವೈದ್ಯರ ಚೀಟಿ (Prescription) ಅಪ್‌ಲೋಡ್",
          icon: "📄",
          steps: [
            "ವೈದ್ಯರ ಚೀಟಿಯ ಸ್ಪಷ್ಟ ಚಿತ್ರವನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.",
            "ಫಾರ್ಮಸಿಸ್ಟ್ ಪ್ರಸ್ತಾವನೆಯನ್ನು (Proposal) ಕಳುಹಿಸುತ್ತಾರೆ.",
            "ಪ್ರಸ್ತಾವನೆ ಒಪ್ಪಿ ನೇರವಾಗಿ ಆರ್ಡರ್ ಮಾಡಿ."
          ]
        },
        {
          title: "3. ಕ್ಯಾಶ್ ಆನ್ ಡೆಲಿವರಿ (COD) ಆರ್ಡರ್",
          icon: "💳",
          steps: [
            "ಡೆಲಿವರಿ ವಿಳಾಸ ಆಯ್ಕೆಮಾಡಿ ಮತ್ತು ಕ್ಯಾಶ್ ಆನ್ ಡೆಲಿವರಿ (COD) ಮೂಲಕ ಆರ್ಡರ್ ಮಾಡಿ."
          ]
        },
        {
          title: "4. ಲೈವ್ ಟ್ರ್ಯಾಕಿಂಗ್ ಮತ್ತು 4-ಅಂಕಿಯ OTP",
          icon: "🛵",
          steps: [
            "ಆರ್ಡರ್ ಡಿಸ್ಪ್ಯಾಚ್ ಆದಾಗ 4-ಅಂಕಿಯ ಡೆಲಿವರಿ OTP ದೊರೆಯುತ್ತದೆ.",
            "ರೈಡರ್ ಬಂದಾಗ ಮಾತ್ರ ಈ OTP ನೀಡಿ ಡೆಲಿವರಿ ಸ್ವೀಕರಿಸಿ."
          ]
        }
      ],
      pharmacy: [
        {
          title: "1. ಆಪರೇಷನ್ಸ್ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
          icon: "📊",
          steps: [
            "ಆರ್ಡರ್‌ಗಳನ್ನು ಹಂತ ಹಂತವಾಗಿ (Approved ➔ Ready ➔ Dispatched ➔ Delivered) ನಿರ್ವಹಿಸಿ."
          ]
        },
        {
          title: "2. ವಾಟ್ಸಾಪ್ ನೋಟಿಫಿಕೇಶನ್ & ರೈಡರ್ ನಿಯೋಜನೆ",
          icon: "📲",
          steps: [
            "ವಾಟ್ಸಾಪ್ ಮೂಲಕ ಗ್ರಾಹಕರಿಗೆ ಡೆಲಿವರಿ OTP ಮತ್ತು ಲೈವ್ ಅಪ್‌ಡೇಟ್‌ಗಳನ್ನು ಕಳುಹಿಸಿ."
          ]
        }
      ],
      rider: [
        {
          title: "1. ರೈಡರ್ ಟರ್ಮಿನಲ್ ಮತ್ತು OTP ದೃಢೀಕರಣ",
          icon: "📱",
          steps: [
            "ಆರ್ಡರ್ ಸ್ವೀಕರಿಸಿ ಗ್ರಾಹಕರ ಡೆಲಿವರಿ ಸ್ಥಳ ತಲುಪಿ.",
            "ಗ್ರಾಹಕರಿಂದ 4-ಅಂಕಿಯ OTP ಪಡೆದು ಟರ್ಮಿನಲ್‌ನಲ್ಲಿ ನಮೂದಿಸಿ."
          ]
        }
      ],
      superadmin: [
        {
          title: "1. ಮಲ್ಟಿ-ಟೆನೆಂಟ್ ಫಾರ್ಮಸಿ ನಿರ್ವಹಣೆ",
          icon: "🏢",
          steps: [
            "ಪ್ರಾದೇಶಿಕ ಫಾರ್ಮಸಿ ಟೆನೆಂಟ್‌ಗಳನ್ನು ನೋಂದಾಯಿಸಿ ಮತ್ತು ಪ್ರವೇಶಾಧಿಕಾರ ನಿರ್ವಹಿಸಿ."
          ]
        }
      ]
    }
  },
  bn: {
    title: "QuickMeds Rx — সম্পূর্ণ অ্যাপ্লিকেশন নির্দেশিকা",
    subtitle: "গ্রাহক, ফার্মেসি ম্যানেজার, ডেলিভারি রাইডার এবং সুপার অ্যাডমিনদের জন্য সহায়িকা।",
    searchPlaceholder: "বিষয় খুঁজুন (যেমন: OTP, প্রেসক্রিপশন, ডিসপ্যাচ, রাইডার)...",
    tabs: {
      customer: "🛒 গ্রাহক নির্দেশিকা",
      pharmacy: "🏥 ফার্মেসি পরিচালনা",
      rider: "🛵 ডেলিভারি রাইডার",
      superadmin: "🛡️ প্ল্যাটফর্ম অ্যাডমিন"
    },
    sections: {
      customer: [
        {
          title: "১. ওষুধ অনুসন্ধান ও স্টক পরীক্ষা",
          icon: "🔍",
          steps: [
            "ব্র্যান্ড বা জেনেরিক নাম দিয়ে ওষুধ খুঁজুন।",
            "লাইভ স্টক এবং কাছাকাছি ব্রাঞ্চ দেখুন।"
          ]
        },
        {
          title: "২. প্রেসক্রিপশন আপলোড এবং অর্ডার",
          icon: "📄",
          steps: [
            "ডাক্তারের প্রেসক্রিপশন আপলোড করুন এবং ফার্মেসির প্রস্তাবনা গ্রহণ করে অর্ডার সম্পন্ন করুন।"
          ]
        },
        {
          title: "৩. লাইভ ট্র্যাকিং এবং ৪-সংখ্যার OTP",
          icon: "🛵",
          steps: [
            "অর্ডার ডেলিভারির সময় প্রাপ্ত ৪-সংখ্যার OTP রাইডারকে প্রদান করুন।"
          ]
        }
      ],
      pharmacy: [
        {
          title: "১. অর্ডার প্রসেসিং ও রাইডার অ্যাসাইনমেন্ট",
          icon: "📊",
          steps: [
            "অর্ডার রিভিউ করুন, প্রস্তুত করুন এবং রাইডার নিয়োগ করুন।"
          ]
        }
      ],
      rider: [
        {
          title: "১. ডেলিভারি সম্পন্নকরণ ও OTP যাচাই",
          icon: "📱",
          steps: [
            "গ্রাহকের কাছ থেকে ৪-সংখ্যার OTP নিয়ে অ্যাপে ডেলিভারি সম্পন্ন করুন।"
          ]
        }
      ],
      superadmin: [
        {
          title: "১. মাল্টি-টেন্যান্ট ফার্মেসি ডিরেক্টরি",
          icon: "🏢",
          steps: [
            "ফার্মেসি টেন্যান্ট এবং পারমিশন পরিচালনা করুন।"
          ]
        }
      ]
    }
  },
  te: {
    title: "QuickMeds Rx — సమగ్ర అప్లికేషన్ గైడ్",
    subtitle: "వినియోగదారులు, ఫార్మసీ మేనేజర్లు, డెలివరీ రైడర్లు మరియు సూపర్‌ అడ్మిన్‌ల మార్గదర్శిని.",
    searchPlaceholder: "విషయాన్ని వెతకండి (ఉదా: OTP, ప్రిస్క్రిప్షన్, రైడర్)...",
    tabs: {
      customer: "🛒 వినియోగదారు మార్గం",
      pharmacy: "🏥 ఫార్మసీ నిర్వహణ",
      rider: "🛵 డెలివరీ రైడర్",
      superadmin: "🛡️ ప్లాట్‌ఫారమ్ అడ్మిన్"
    },
    sections: {
      customer: [
        {
          title: "1. మందుల శోధన మరియు లభ్యత",
          icon: "🔍",
          steps: [
            "బ్రాండ్ లేదా కాంబినేషన్ పేరుతో మందులను శోధించండి.",
            "రియల్-టైమ్ స్టాక్ మరియు దగ్గరి బ్రాంచ్ లభ్యత చూడండి."
          ]
        },
        {
          title: "2. ప్రిస్క్రిప్షన్ అప్‌లోడ్ మరియు ఆర్డర్",
          icon: "📄",
          steps: [
            "డాక్టర్ ప్రిస్క్రిప్షన్ అప్‌లోడ్ చేయండి. ఫార్మసిస్ట్ ప్రతిపాదనను ఆమోదించి ఆర్డర్ చేయండి."
          ]
        },
        {
          title: "3. లైవ్ ట్రాకింగ్ మరియు 4-అంకెల OTP",
          icon: "🛵",
          steps: [
            "ఆర్డర్ డెలివరీ అవుతున్నప్పుడు 4-అంకెల OTP ఉపయోగించి రైడర్‌కు ధృవీకరించండి."
          ]
        }
      ],
      pharmacy: [
        {
          title: "1. ఆర్డర్ ప్రాసెసింగ్ మరియు డిస్పాచ్",
          icon: "📊",
          steps: [
            "ఆర్డర్ స్థాయిలను మార్చండి మరియు రైడర్లను కేటాయించండి."
          ]
        }
      ],
      rider: [
        {
          title: "1. డెలివరీ పూర్తీకరణ & OTP ధృవీకరణ",
          icon: "📱",
          steps: [
            "కస్టమర్ నుండి 4-అంకెల OTP తీసుకుని ఆర్డర్ డెలివరీ పూర్తి చేయండి."
          ]
        }
      ],
      superadmin: [
        {
          title: "1. మల్టీ-టెనెంట్ నిర్వహణ",
          icon: "🏢",
          steps: [
            "రీజినల్ ఫార్మసీ టెనెంట్లను మరియు అనుమతులను నిర్వహించండి."
          ]
        }
      ]
    }
  }
};

export default function ApplicationGuideModal({ isOpen, onClose }) {
  const { language, setLanguage, languages, t } = useLanguage();
  const [activeTab, setActiveTab] = useState('customer');
  const [searchQuery, setSearchQuery] = useState('');

  const currentGuide = useMemo(() => {
    return GUIDE_DATA[language] || GUIDE_DATA.en;
  }, [language]);

  const filteredSections = useMemo(() => {
    const list = currentGuide.sections?.[activeTab] || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.steps.some(s => s.toLowerCase().includes(q))
    );
  }, [currentGuide, activeTab, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-2 sm:p-5 modal-overlay animate-fade-in overscroll-none"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose?.(); } }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="app-guide-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm touch-none"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="pharma-modal-surface relative z-10 m-auto flex h-[96dvh] sm:h-[88dvh] max-h-[96dvh] sm:max-h-[88dvh] min-h-0 w-[96vw] sm:w-full max-w-3xl flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overscroll-contain">
        
        {/* Compact Responsive Modal Header */}
        <div className="shrink-0 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 p-3.5 sm:p-5 text-white space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg sm:text-xl shrink-0">📖</span>
              <h2 id="app-guide-title" className="text-sm sm:text-lg font-black tracking-tight text-white truncate">
                {currentGuide.title}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition cursor-pointer text-sm font-bold min-h-[32px]"
            >
              ✕
            </button>
          </div>

          <p className="hidden sm:block text-xs text-slate-300 font-medium leading-relaxed max-w-xl">
            {currentGuide.subtitle}
          </p>

          {/* Compact Single-Row Language Ribbon */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10">
            <span className="text-[10px] sm:text-[11px] font-bold text-blue-200 shrink-0">
              🌐 Language:
            </span>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 max-w-full">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLanguage(lang.code)}
                  className={`px-2.5 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-xs font-black whitespace-nowrap transition cursor-pointer flex items-center gap-1 ${
                    language === lang.code
                      ? 'bg-blue-600 text-white shadow-xs ring-1 ring-blue-300'
                      : 'bg-white/10 hover:bg-white/20 text-slate-200'
                  }`}
                >
                  <span>{lang.nativeLabel}</span>
                  {language === lang.code && <span className="text-[9px]">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Compact Tab & Search Header Bar */}
        <div className="shrink-0 bg-slate-50 dark:bg-slate-800/60 p-2.5 sm:p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
          {/* Persona Tabs - Responsive Scroll Container */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
            {Object.entries(currentGuide.tabs).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => {
                  setActiveTab(tabKey);
                  setSearchQuery('');
                }}
                className={`px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-extrabold whitespace-nowrap transition cursor-pointer min-h-[34px] ${
                  activeTab === tabKey
                    ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-2xs border border-blue-200/80 dark:border-blue-800'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search Filter Input */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={currentGuide.searchPlaceholder}
              className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 pl-8 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute left-2.5 top-2 text-xs text-slate-400">🔍</span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1.5 text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Maximized Scrollable Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-3 sm:space-y-4 overscroll-contain">
          {filteredSections.length === 0 ? (
            <div className="py-8 text-center text-slate-400 space-y-2">
              <span className="text-2xl block">🔍</span>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No guide topics match your search.</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear Search
              </button>
            </div>
          ) : (
            filteredSections.map((sec, idx) => (
              <div
                key={idx}
                className="rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-4 shadow-2xs space-y-2.5 transition hover:border-blue-300 dark:hover:border-blue-700"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                  <span className="text-base sm:text-lg p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-900 shrink-0">
                    {sec.icon}
                  </span>
                  <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 leading-snug">
                    {sec.title}
                  </h3>
                </div>

                <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium">
                  {sec.steps.map((step, sIdx) => (
                    <li key={sIdx} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-blue-600 dark:text-blue-400 font-bold shrink-0">•</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* Compact Docked Footer */}
        <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-2.5 sm:p-4 flex items-center justify-between gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] sm:text-[11px] truncate">
            💡 QuickMeds Rx Guide • {languages.find(l => l.code === language)?.nativeLabel || 'English'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition cursor-pointer min-h-[40px] shrink-0"
          >
            {t('close')}
          </button>
        </div>

      </div>
    </div>
  );
}
