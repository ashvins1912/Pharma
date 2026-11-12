import test from 'node:test';
import assert from 'node:assert/strict';
import {
    detectVoiceCommand,
    getVoiceLocale,
    getVoiceResponse,
    selectSpeechVoice,
    stripVoiceSearchPrefix
} from '../src/components/common/voiceLanguage.js';

test('maps all application languages to Indian speech-recognition locales', () => {
    assert.deepEqual(['en', 'hi', 'kn', 'bn', 'te'].map(getVoiceLocale),
        ['en-IN', 'hi-IN', 'kn-IN', 'bn-IN', 'te-IN']);
});

test('selects exact locale voice before a default voice in another language', () => {
    const voices = [
        { name: 'Default English', lang: 'en-US', default: true },
        { name: 'Hindi', lang: 'hi-IN' },
        { name: 'Hindi generic', lang: 'hi' }
    ];
    assert.equal(selectSpeechVoice(voices, 'hi').name, 'Hindi');
});

test('falls back to a same-language voice when exact regional voice is unavailable', () => {
    const voices = [{ name: 'Kannada generic', lang: 'kn' }, { name: 'English', lang: 'en-US' }];
    assert.equal(selectSpeechVoice(voices, 'kn').name, 'Kannada generic');
});

test('detects common localized navigation commands', () => {
    assert.equal(detectVoiceCommand('मेरे ऑर्डर दिखाएं', 'hi').intent, 'OPEN_ORDERS');
    assert.equal(detectVoiceCommand('ವಿಳಾಸ ತೆರೆಯಿರಿ', 'kn').intent, 'OPEN_ADDRESSES');
    assert.equal(detectVoiceCommand('আমার অর্ডার', 'bn').intent, 'OPEN_ORDERS');
    assert.equal(detectVoiceCommand('నా ఆర్డర్లు', 'te').intent, 'OPEN_ORDERS');
});

test('detects localized new medicine requests and search prefixes', () => {
    assert.equal(detectVoiceCommand('नया दवा अनुरोध', 'hi').intent, 'NEW_REQUEST');
    assert.equal(detectVoiceCommand('కొత్త మందుల అభ్యర్థన', 'te').intent, 'NEW_REQUEST');
    assert.equal(detectVoiceCommand('খুঁজুন Dolo 650', 'bn').query, 'Dolo 650');
    assert.equal(stripVoiceSearchPrefix('ಹುಡುಕಿ Dolo 650', 'kn'), 'Dolo 650');
});

test('speaks feedback in the selected language', () => {
    assert.match(getVoiceResponse('READY', 'hi'), /वॉइस/);
    assert.match(getVoiceResponse('READY', 'kn'), /ಧ್ವನಿ/);
    assert.match(getVoiceResponse('READY', 'bn'), /ভয়েস/);
    assert.match(getVoiceResponse('READY', 'te'), /వాయిస్/);
});
