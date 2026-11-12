/**
 * Language-aware browser speech helpers.
 * Recognition uses the selected application locale; synthesis selects the closest
 * installed voice by BCP-47 language match and always sets the utterance locale.
 */

export const VOICE_LOCALES = Object.freeze({
    en: 'en-IN',
    hi: 'hi-IN',
    kn: 'kn-IN',
    bn: 'bn-IN',
    te: 'te-IN'
});

const COMMANDS = {
    en: {
        OPEN_ORDERS: ['orders', 'order history', 'tracking', 'track order', 'my order', 'receipts'],
        REQUESTS: ['request', 'requests', 'proposal', 'procure', 'inquiry'],
        NEW: ['new', 'create', 'add', 'submit', 'make'],
        ADDRESSES: ['address', 'addresses', 'delivery location', 'home location'],
        CART: ['cart', 'checkout', 'basket', 'shopping bag'],
        PROFILE: ['profile', 'account', 'my details', 'settings', 'security'],
        STORE: ['store', 'shop', 'catalog', 'home', 'browse', 'products'],
        CLEAR: ['clear', 'reset', 'show all'],
        SEARCH: ['search for', 'search', 'find me', 'look up', 'get me', 'where is', 'buy', 'show me', 'find']
    },
    hi: {
        OPEN_ORDERS: ['ऑर्डर इतिहास', 'मेरे ऑर्डर', 'ऑर्डर', 'आदेश', 'ट्रैकिंग'],
        REQUESTS: ['दवा अनुरोध', 'अनुरोध', 'प्रस्ताव', 'दवा मंगवाना'],
        NEW: ['नया', 'बनाएं', 'बनाओ', 'जोड़ें', 'जमा'],
        ADDRESSES: ['पता', 'पते', 'डिलीवरी का पता', 'घर का पता'],
        CART: ['कार्ट', 'टोकरी', 'चेकआउट'],
        PROFILE: ['प्रोफ़ाइल', 'खाता', 'सेटिंग'],
        STORE: ['दुकान', 'स्टोर', 'कैटलॉग', 'उत्पाद'],
        CLEAR: ['साफ़', 'रीसेट', 'हटाएं'],
        SEARCH: ['खोजें', 'खोज', 'ढूंढें', 'ढूँढें', 'दिखाएं', 'मुझे दें']
    },
    kn: {
        OPEN_ORDERS: ['ಆರ್ಡರ್ ಇತಿಹಾಸ', 'ನನ್ನ ಆರ್ಡರ್', 'ಆರ್ಡರ್‌ಗಳು', 'ಆರ್ಡರ್', 'ಟ್ರ್ಯಾಕಿಂಗ್'],
        REQUESTS: ['ಔಷಧಿ ವಿನಂತಿ', 'ವಿನಂತಿಗಳು', 'ವಿನಂತಿ', 'ಪ್ರಸ್ತಾವನೆ'],
        NEW: ['ಹೊಸ', 'ರಚಿಸಿ', 'ಸೇರಿಸಿ', 'ಸಲ್ಲಿಸಿ'],
        ADDRESSES: ['ವಿಳಾಸ', 'ವಿಳಾಸಗಳು', 'ವಿತರಣಾ ವಿಳಾಸ'],
        CART: ['ಕಾರ್ಟ್', 'ಬ್ಯಾಸ್ಕೆಟ್', 'ಚೆಕ್‌ಔಟ್'],
        PROFILE: ['ಪ್ರೊಫೈಲ್', 'ಖಾತೆ', 'ಸೆಟ್ಟಿಂಗ್'],
        STORE: ['ಅಂಗಡಿ', 'ಸ್ಟೋರ್', 'ಕ್ಯಾಟಲಾಗ್', 'ಉತ್ಪನ್ನಗಳು'],
        CLEAR: ['ತೆರವುಗೊಳಿಸಿ', 'ಮರುಹೊಂದಿಸಿ'],
        SEARCH: ['ಹುಡುಕಿ', 'ಹುಡುಕಿರಿ', 'ತೋರಿಸಿ']
    },
    bn: {
        OPEN_ORDERS: ['অর্ডার ইতিহাস', 'আমার অর্ডার', 'অর্ডার', 'ট্র্যাকিং'],
        REQUESTS: ['ওষুধের অনুরোধ', 'অনুরোধ', 'প্রস্তাব'],
        NEW: ['নতুন', 'তৈরি', 'যোগ', 'জমা'],
        ADDRESSES: ['ঠিকানা', 'ডেলিভারি ঠিকানা', 'বাড়ির ঠিকানা'],
        CART: ['কার্ট', 'ঝুড়ি', 'চেকআউট'],
        PROFILE: ['প্রোফাইল', 'অ্যাকাউন্ট', 'সেটিংস'],
        STORE: ['দোকান', 'স্টোর', 'ক্যাটালগ', 'পণ্য'],
        CLEAR: ['পরিষ্কার', 'রিসেট', 'সব দেখান'],
        SEARCH: ['খুঁজুন', 'খোঁজ', 'সার্চ', 'দেখান']
    },
    te: {
        OPEN_ORDERS: ['ఆర్డర్ చరిత్ర', 'నా ఆర్డర్లు', 'ఆర్డర్లు', 'ఆర్డర్', 'ట్రాకింగ్'],
        REQUESTS: ['మందుల అభ్యర్థన', 'అభ్యర్థనలు', 'అభ్యర్థన', 'ప్రతిపాదన'],
        NEW: ['కొత్త', 'సృష్టించు', 'జోడించు', 'సమర్పించు'],
        ADDRESSES: ['చిరునామా', 'చిరునామాలు', 'డెలివరీ చిరునామా'],
        CART: ['కార్ట్', 'బాస్కెట్', 'చెకౌట్'],
        PROFILE: ['ప్రొఫైల్', 'ఖాతా', 'సెట్టింగులు'],
        STORE: ['స్టోర్', 'దుకాణం', 'కేటలాగ్', 'ఉత్పత్తులు'],
        CLEAR: ['తొలగించు', 'రీసెట్', 'అన్నీ చూపించు'],
        SEARCH: ['వెతకండి', 'వెతుకు', 'శోధించు', 'చూపించు']
    }
};

const RESPONSES = {
    en: {
        OPEN_ORDERS: 'Opening your order history and tracking.',
        OPEN_REQUESTS: 'Opening medicine requests.',
        NEW_REQUEST: 'Opening a new medicine request.',
        OPEN_ADDRESSES: 'Opening saved addresses.',
        OPEN_CART: 'Opening your shopping cart.',
        OPEN_PROFILE: 'Opening your profile.',
        OPEN_STORE: 'Opening the medicine store.',
        CLEAR_SEARCH: 'Clearing search filters.',
        READY: 'Voice assistant ready. Tap the microphone and speak.',
        SEARCHING: 'Searching for',
        MATCHED: 'Matched'
    },
    hi: {
        OPEN_ORDERS: 'आपके ऑर्डर और उनकी स्थिति खोली जा रही है।',
        OPEN_REQUESTS: 'दवा अनुरोध खोले जा रहे हैं।',
        NEW_REQUEST: 'नया दवा अनुरोध खोला जा रहा है।',
        OPEN_ADDRESSES: 'आपके सहेजे गए पते खोले जा रहे हैं।',
        OPEN_CART: 'आपकी खरीदारी की कार्ट खोली जा रही है।',
        OPEN_PROFILE: 'आपकी प्रोफ़ाइल खोली जा रही है।',
        OPEN_STORE: 'दवाओं की दुकान खोली जा रही है।',
        CLEAR_SEARCH: 'खोज फ़िल्टर हटाए जा रहे हैं।',
        READY: 'वॉइस असिस्टेंट तैयार है। बोलने के लिए माइक्रोफ़ोन दबाएं।',
        SEARCHING: 'खोज जारी है',
        MATCHED: 'मिलान हुआ'
    },
    kn: {
        OPEN_ORDERS: 'ನಿಮ್ಮ ಆರ್ಡರ್ ಇತಿಹಾಸ ಮತ್ತು ಟ್ರ್ಯಾಕಿಂಗ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ.',
        OPEN_REQUESTS: 'ಔಷಧಿ ವಿನಂತಿಗಳನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.',
        NEW_REQUEST: 'ಹೊಸ ಔಷಧಿ ವಿನಂತಿಯನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.',
        OPEN_ADDRESSES: 'ಉಳಿಸಿದ ವಿಳಾಸಗಳನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.',
        OPEN_CART: 'ನಿಮ್ಮ ಕಾರ್ಟ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ.',
        OPEN_PROFILE: 'ನಿಮ್ಮ ಪ್ರೊಫೈಲ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ.',
        OPEN_STORE: 'ಔಷಧಿ ಅಂಗಡಿಯನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.',
        CLEAR_SEARCH: 'ಹುಡುಕಾಟ ಫಿಲ್ಟರ್‌ಗಳನ್ನು ತೆರವುಗೊಳಿಸಲಾಗುತ್ತಿದೆ.',
        READY: 'ಧ್ವನಿ ಸಹಾಯಕ ಸಿದ್ಧವಾಗಿದೆ. ಮಾತನಾಡಲು ಮೈಕ್ರೊಫೋನ್ ಒತ್ತಿರಿ.',
        SEARCHING: 'ಹುಡುಕಲಾಗುತ್ತಿದೆ',
        MATCHED: 'ಹೊಂದಾಣಿಕೆಯಾಗಿದೆ'
    },
    bn: {
        OPEN_ORDERS: 'আপনার অর্ডার এবং ট্র্যাকিং খোলা হচ্ছে।',
        OPEN_REQUESTS: 'ওষুধের অনুরোধ খোলা হচ্ছে।',
        NEW_REQUEST: 'নতুন ওষুধের অনুরোধ খোলা হচ্ছে।',
        OPEN_ADDRESSES: 'সংরক্ষিত ঠিকানা খোলা হচ্ছে।',
        OPEN_CART: 'আপনার কার্ট খোলা হচ্ছে।',
        OPEN_PROFILE: 'আপনার প্রোফাইল খোলা হচ্ছে।',
        OPEN_STORE: 'ওষুধের দোকান খোলা হচ্ছে।',
        CLEAR_SEARCH: 'সার্চ ফিল্টার পরিষ্কার করা হচ্ছে।',
        READY: 'ভয়েস সহকারী প্রস্তুত। কথা বলতে মাইক্রোফোন চাপুন।',
        SEARCHING: 'খোঁজা হচ্ছে',
        MATCHED: 'মিল পাওয়া গেছে'
    },
    te: {
        OPEN_ORDERS: 'మీ ఆర్డర్ చరిత్ర మరియు ట్రాకింగ్ తెరవబడుతున్నాయి.',
        OPEN_REQUESTS: 'మందుల అభ్యర్థనలు తెరవబడుతున్నాయి.',
        NEW_REQUEST: 'కొత్త మందుల అభ్యర్థన తెరవబడుతోంది.',
        OPEN_ADDRESSES: 'సేవ్ చేసిన చిరునామాలు తెరవబడుతున్నాయి.',
        OPEN_CART: 'మీ కార్ట్ తెరవబడుతోంది.',
        OPEN_PROFILE: 'మీ ప్రొఫైల్ తెరవబడుతోంది.',
        OPEN_STORE: 'మందుల స్టోర్ తెరవబడుతోంది.',
        CLEAR_SEARCH: 'శోధన ఫిల్టర్లు తొలగించబడుతున్నాయి.',
        READY: 'వాయిస్ అసిస్టెంట్ సిద్ధంగా ఉంది. మాట్లాడటానికి మైక్రోఫోన్ నొక్కండి.',
        SEARCHING: 'వెతుకుతోంది',
        MATCHED: 'సరిపోలింది'
    }
};

export function getVoiceLocale(language = 'en') {
    const code = String(language || 'en').toLowerCase().split('-')[0];
    return VOICE_LOCALES[code] || VOICE_LOCALES.en;
}

export function selectSpeechVoice(voices = [], language = 'en') {
    const locale = getVoiceLocale(language).toLowerCase();
    const base = locale.split('-')[0];
    return [...(Array.isArray(voices) ? voices : [])]
        .map((voice) => {
            const voiceLocale = String(voice?.lang || '').toLowerCase();
            let score = 0;
            if (voiceLocale === locale) score = 100;
            else if (voiceLocale.split('-')[0] === base) score = 75;
            if (voice?.default) score += 2;
            if (voice?.localService) score += 1;
            return { voice, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.voice || null;
}

export function speakVoiceText(text, language = 'en') {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)
        || typeof window.SpeechSynthesisUtterance !== 'function' || !text) return false;
    try {
        const utterance = new window.SpeechSynthesisUtterance(String(text));
        utterance.lang = getVoiceLocale(language);
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        const voice = selectSpeechVoice(window.speechSynthesis.getVoices(), language);
        if (voice) utterance.voice = voice;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        return true;
    } catch (error) {
        console.warn('[VoiceAssistant] Speech synthesis failed:', error);
        return false;
    }
}

function includesAny(text, phrases = []) {
    return phrases.some((phrase) => phrase && text.includes(phrase));
}

export function detectVoiceCommand(transcript, language = 'en') {
    const text = String(transcript || '').normalize('NFC').trim().toLocaleLowerCase();
    if (!text) return null;
    const code = String(language || 'en').toLowerCase().split('-')[0];
    const dictionary = COMMANDS[code] || COMMANDS.en;

    if (includesAny(text, dictionary.OPEN_ORDERS)) return { intent: 'OPEN_ORDERS' };
    if (includesAny(text, dictionary.REQUESTS)) {
        return { intent: includesAny(text, dictionary.NEW) ? 'NEW_REQUEST' : 'OPEN_REQUESTS' };
    }
    if (includesAny(text, dictionary.ADDRESSES)) return { intent: 'OPEN_ADDRESSES' };
    if (includesAny(text, dictionary.CART)) return { intent: 'OPEN_CART' };
    if (includesAny(text, dictionary.PROFILE)) return { intent: 'OPEN_PROFILE' };
    if (includesAny(text, dictionary.STORE)) return { intent: 'OPEN_STORE' };
    if (includesAny(text, dictionary.CLEAR) && (text.includes('search') || text.includes('filter')
        || includesAny(text, dictionary.SEARCH))) return { intent: 'CLEAR_SEARCH' };

    if (includesAny(text, dictionary.SEARCH)) {
        return { intent: 'SEARCH', query: stripVoiceSearchPrefix(text, code) };
    }
    return null;
}

export function stripVoiceSearchPrefix(transcript, language = 'en') {
    const text = String(transcript || '').normalize('NFC').trim();
    const code = String(language || 'en').toLowerCase().split('-')[0];
    const phrases = [...(COMMANDS[code] || COMMANDS.en).SEARCH]
        .sort((a, b) => b.length - a.length);
    for (const phrase of phrases) {
        if (text.startsWith(phrase)) {
            return text.slice(phrase.length).replace(/^[\s,:-]+/u, '').trim();
        }
    }
    return text.replace(/^(search for|search|find me|look up|get me|where is|buy|order|show me|find|open)\s+/i, '').trim();
}

export function getVoiceResponse(key, language = 'en', query = '') {
    const code = String(language || 'en').toLowerCase().split('-')[0];
    const dictionary = RESPONSES[code] || RESPONSES.en;
    const response = dictionary[key] || RESPONSES.en[key] || '';
    return query && (key === 'SEARCHING' || key === 'MATCHED') ? response + ' ' + query : response;
}
