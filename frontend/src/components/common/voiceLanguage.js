export const VOICE_LOCALES = Object.freeze({ en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', bn: 'bn-IN', te: 'te-IN' });
const codeOf = (value) => String(value || 'en').toLowerCase().split('-')[0];
const COMMANDS = {
 en: { orders:['orders','order history','open orders','my orders','track order'], requests:['medicine request','medicine requests','requests','proposal'], new:['new','create','add','submit'], addresses:['saved addresses','delivery address','my address','addresses'], cart:['shopping cart','open cart','checkout','basket'], profile:['my profile','user profile','my account','settings'], store:['medicine store','open store','catalog','browse medicines'], clear:['clear search','reset search','clear filters','reset filters'], search:['search for','search','find me','look up','get me','where is','buy','show me','find'] },
 hi: { orders:['ऑर्डर इतिहास','मेरे ऑर्डर','ऑर्डर दिखाएं','ऑर्डर ट्रैकिंग'], requests:['दवा अनुरोध','दवा के अनुरोध','अनुरोध','प्रस्ताव'], new:['नया','बनाएं','बनाओ','जोड़ें','जमा'], addresses:['सहेजे गए पते','डिलीवरी का पता','मेरा पता','पते'], cart:['शॉपिंग कार्ट','कार्ट खोलें','चेकआउट','टोकरी'], profile:['मेरी प्रोफ़ाइल','प्रोफ़ाइल','मेरा खाता','सेटिंग'], store:['दवा की दुकान','दुकान खोलें','स्टोर','कैटलॉग'], clear:['खोज साफ़ करें','फ़िल्टर हटाएं'], search:['खोजें','खोज','ढूंढें','ढूँढें','दिखाएं','मुझे दें'] },
 kn: { orders:['ಆರ್ಡರ್ ಇತಿಹಾಸ','ನನ್ನ ಆರ್ಡರ್‌ಗಳು','ಆರ್ಡರ್ ತೋರಿಸಿ'], requests:['ಔಷಧಿ ವಿನಂತಿ','ಔಷಧಿ ವಿನಂತಿಗಳು','ವಿನಂತಿಗಳು','ಪ್ರಸ್ತಾವನೆ'], new:['ಹೊಸ','ರಚಿಸಿ','ಸೇರಿಸಿ','ಸಲ್ಲಿಸಿ'], addresses:['ಉಳಿಸಿದ ವಿಳಾಸಗಳು','ವಿತರಣಾ ವಿಳಾಸ','ನನ್ನ ವಿಳಾಸ','ವಿಳಾಸಗಳು'], cart:['ಶಾಪಿಂಗ್ ಕಾರ್ಟ್','ಕಾರ್ಟ್ ತೆರೆಯಿರಿ','ಚೆಕ್‌ಔಟ್'], profile:['ನನ್ನ ಪ್ರೊಫೈಲ್','ಪ್ರೊಫೈಲ್','ನನ್ನ ಖಾತೆ'], store:['ಔಷಧಿ ಅಂಗಡಿ','ಅಂಗಡಿ ತೆರೆಯಿರಿ','ಸ್ಟೋರ್','ಕ್ಯಾಟಲಾಗ್'], clear:['ಹುಡುಕಾಟ ತೆರವುಗೊಳಿಸಿ','ಫಿಲ್ಟರ್ ತೆರವುಗೊಳಿಸಿ'], search:['ಹುಡುಕಿ','ಹುಡುಕಿರಿ','ತೋರಿಸಿ'] },
 bn: { orders:['অর্ডার ইতিহাস','আমার অর্ডার','অর্ডার দেখান'], requests:['ওষুধের অনুরোধ','ওষুধ অনুরোধ','অনুরোধ','প্রস্তাব'], new:['নতুন','তৈরি','যোগ','জমা'], addresses:['সংরক্ষিত ঠিকানা','ডেলিভারি ঠিকানা','আমার ঠিকানা','ঠিকানা'], cart:['শপিং কার্ট','কার্ট খুলুন','চেকআউট','ঝুড়ি'], profile:['আমার প্রোফাইল','প্রোফাইল','আমার অ্যাকাউন্ট'], store:['ওষুধের দোকান','দোকান খুলুন','স্টোর','ক্যাটালগ'], clear:['সার্চ পরিষ্কার','ফিল্টার পরিষ্কার'], search:['খুঁজুন','খোঁজ','সার্চ','দেখান'] },
 te: { orders:['ఆర్డర్ చరిత్ర','నా ఆర్డర్లు','ఆర్డర్లు చూపించు'], requests:['మందుల అభ్యర్థన','మందుల అభ్యర్థనలు','అభ్యర్థనలు','ప్రతిపాదన'], new:['కొత్త','సృష్టించు','జోడించు','సమర్పించు'], addresses:['సేవ్ చేసిన చిరునామాలు','డెలివరీ చిరునామా','నా చిరునామా','చిరునామాలు'], cart:['షాపింగ్ కార్ట్','కార్ట్ తెరువు','చెకౌట్','బాస్కెట్'], profile:['నా ప్రొఫైల్','ప్రొఫైల్','నా ఖాతా'], store:['మందుల స్టోర్','స్టోర్ తెరువు','దుకాణం','కేటలాగ్'], clear:['శోధనను క్లియర్ చేయి','ఫిల్టర్లను తొలగించు'], search:['వెతకండి','వెతుకు','శోధించు','చూపించు'] }
};
const EN_RESP = { OPEN_ORDERS:'Opening your orders and tracking.', OPEN_REQUESTS:'Opening medicine requests.', NEW_REQUEST:'Opening a new medicine request.', OPEN_ADDRESSES:'Opening saved addresses.', OPEN_CART:'Opening your shopping cart.', OPEN_PROFILE:'Opening your profile.', OPEN_STORE:'Opening the medicine store.', CLEAR_SEARCH:'Clearing search filters.', READY:'Voice assistant ready. Tap the microphone and speak.', SEARCHING:'Searching for', MATCHED:'Matched' };
const RESP = {
 en: EN_RESP,
 hi: { OPEN_ORDERS:'आपके ऑर्डर और उनकी स्थिति खोली जा रही है।', OPEN_REQUESTS:'दवा अनुरोध खोले जा रहे हैं।', NEW_REQUEST:'नया दवा अनुरोध खोला जा रहा है।', OPEN_ADDRESSES:'सहेजे गए पते खोले जा रहे हैं।', OPEN_CART:'आपकी कार्ट खोली जा रही है।', OPEN_PROFILE:'आपकी प्रोफ़ाइल खोली जा रही है।', OPEN_STORE:'दवाओं की दुकान खोली जा रही है।', CLEAR_SEARCH:'खोज फ़िल्टर हटाए जा रहे हैं।', READY:'वॉइस असिस्टेंट तैयार है। बोलने के लिए माइक्रोफ़ोन दबाएं।', SEARCHING:'खोज जारी है', MATCHED:'मिलान हुआ' },
 kn: { OPEN_ORDERS:'ನಿಮ್ಮ ಆರ್ಡರ್‌ಗಳು ತೆರೆಯಲಾಗುತ್ತಿದೆ.', OPEN_REQUESTS:'ಔಷಧಿ ವಿನಂತಿಗಳನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.', NEW_REQUEST:'ಹೊಸ ಔಷಧಿ ವಿನಂತಿಯನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.', OPEN_ADDRESSES:'ಉಳಿಸಿದ ವಿಳಾಸಗಳನ್ನು ತೆರೆಯಲಾಗುತ್ತಿದೆ.', OPEN_CART:'ನಿಮ್ಮ ಕಾರ್ಟ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ.', OPEN_PROFILE:'ನಿಮ್ಮ ಪ್ರೊಫೈಲ್ ತೆರೆಯಲಾಗುತ್ತಿದೆ.', OPEN_STORE:'ಔಷಧಿ ಅಂಗಡಿ ತೆರೆಯಲಾಗುತ್ತಿದೆ.', CLEAR_SEARCH:'ಹುಡುಕಾಟ ಫಿಲ್ಟರ್ ತೆರವುಗೊಳಿಸಲಾಗುತ್ತಿದೆ.', READY:'ಧ್ವನಿ ಸಹಾಯಕ ಸಿದ್ಧವಾಗಿದೆ. ಮಾತನಾಡಲು ಮೈಕ್ರೊಫೋನ್ ಒತ್ತಿರಿ.', SEARCHING:'ಹುಡುಕಲಾಗುತ್ತಿದೆ', MATCHED:'ಹೊಂದಾಣಿಕೆಯಾಗಿದೆ' },
 bn: { OPEN_ORDERS:'আপনার অর্ডার এবং ট্র্যাকিং খোলা হচ্ছে।', OPEN_REQUESTS:'ওষুধের অনুরোধ খোলা হচ্ছে।', NEW_REQUEST:'নতুন ওষুধের অনুরোধ খোলা হচ্ছে।', OPEN_ADDRESSES:'সংরক্ষিত ঠিকানা খোলা হচ্ছে।', OPEN_CART:'আপনার কার্ট খোলা হচ্ছে।', OPEN_PROFILE:'আপনার প্রোফাইল খোলা হচ্ছে।', OPEN_STORE:'ওষুধের দোকান খোলা হচ্ছে।', CLEAR_SEARCH:'সার্চ ফিল্টার পরিষ্কার করা হচ্ছে।', READY:'ভয়েস সহকারী প্রস্তুত। কথা বলতে মাইক্রোফোন চাপুন।', SEARCHING:'খোঁজা হচ্ছে', MATCHED:'মিল পাওয়া গেছে' },
 te: { OPEN_ORDERS:'మీ ఆర్డర్లు తెరవబడుతున్నాయి.', OPEN_REQUESTS:'మందుల అభ్యర్థనలు తెరవబడుతున్నాయి.', NEW_REQUEST:'కొత్త మందుల అభ్యర్థన తెరవబడుతోంది.', OPEN_ADDRESSES:'సేవ్ చేసిన చిరునామాలు తెరవబడుతున్నాయి.', OPEN_CART:'మీ కార్ట్ తెరవబడుతోంది.', OPEN_PROFILE:'మీ ప్రొఫైల్ తెరవబడుతోంది.', OPEN_STORE:'మందుల స్టోర్ తెరవబడుతోంది.', CLEAR_SEARCH:'శోధన ఫిల్టర్లు తొలగించబడుతున్నాయి.', READY:'వాయిస్ అసిస్టెంట్ సిద్ధంగా ఉంది. మాట్లాడటానికి మైక్రోఫోన్ నొక్కండి.', SEARCHING:'వెతుకుతోంది', MATCHED:'సరిపోలింది' }
};
export function getVoiceLocale(language='en') { return VOICE_LOCALES[codeOf(language)] || VOICE_LOCALES.en; }
export function selectSpeechVoice(voices=[], language='en') {
 const locale=getVoiceLocale(language).toLowerCase(), base=locale.split('-')[0];
 return (Array.isArray(voices)?voices:[]).map(voice=>({voice,score:(String(voice?.lang||'').toLowerCase()===locale?100:String(voice?.lang||'').toLowerCase().split('-')[0]===base?75:0)+(voice?.default?2:0)+(voice?.localService?1:0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)[0]?.voice||null;
}
export function speakVoiceText(text, language='en') {
 if(typeof window==='undefined'||!window.speechSynthesis||typeof window.SpeechSynthesisUtterance!=='function'||!text)return false;
 try { const u=new window.SpeechSynthesisUtterance(String(text)); u.lang=getVoiceLocale(language); u.rate=1; u.pitch=1; u.volume=1; const voice=selectSpeechVoice(window.speechSynthesis.getVoices(),language); if(voice)u.voice=voice; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); return true; }
 catch(error){ console.warn('[VoiceAssistant] Speech synthesis failed:',error); return false; }
}
const any=(text,items=[])=>items.some(x=>text.includes(x));
export function stripVoiceSearchPrefix(input,language='en') {
 const text=String(input||'').normalize('NFC').trim(), local=COMMANDS[codeOf(language)]||COMMANDS.en;
 const prefixes=[...(local.search||[]),...COMMANDS.en.search].sort((a,b)=>b.length-a.length);
 for(const prefix of prefixes)if(text.toLowerCase().startsWith(prefix.toLowerCase()))return text.slice(prefix.length).replace(/^[\s,:-]+/u,'').trim();
 return text.replace(/^(search for|search|find me|look up|get me|where is|buy|order|show me|find|open)\s+/i,'').trim();
}
export function detectVoiceCommand(input,language='en') {
 const text=String(input||'').normalize('NFC').trim().toLocaleLowerCase(); if(!text)return null;
 const local=COMMANDS[codeOf(language)]||COMMANDS.en, en=COMMANDS.en;
 const list=k=>[...new Set([...(local[k]||[]),...(en[k]||[])])];
 if(any(text,list('orders')))return {intent:'OPEN_ORDERS'};
 if(any(text,list('requests')))return {intent:any(text,list('new'))?'NEW_REQUEST':'OPEN_REQUESTS'};
 if(any(text,list('addresses')))return {intent:'OPEN_ADDRESSES'};
 if(any(text,list('cart')))return {intent:'OPEN_CART'};
 if(any(text,list('profile')))return {intent:'OPEN_PROFILE'};
 if(any(text,list('store')))return {intent:'OPEN_STORE'};
 if(any(text,list('clear')))return {intent:'CLEAR_SEARCH'};
 if(any(text,list('search')))return {intent:'SEARCH',query:stripVoiceSearchPrefix(text,language)};
 return null;
}
export function getVoiceResponse(key,language='en',query='') {
 const msg=(RESP[codeOf(language)]||RESP.en)[key]||EN_RESP[key]||'';
 return query&&['SEARCHING','MATCHED'].includes(key)?msg+' '+query:msg;
}
