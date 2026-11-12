import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVoiceCommand, getVoiceLocale, getVoiceResponse, selectSpeechVoice } from '../src/components/common/voiceLanguage.js';
test('maps all application languages to Indian recognition locales',()=>assert.deepEqual(['en','hi','kn','bn','te'].map(getVoiceLocale),['en-IN','hi-IN','kn-IN','bn-IN','te-IN']));
test('selects matching TTS locale before another-language default',()=>assert.equal(selectSpeechVoice([{name:'English',lang:'en-US',default:true},{name:'Hindi',lang:'hi-IN'}],'hi').name,'Hindi'));
test('recognizes Hindi, Kannada, Bengali and Telugu navigation',()=>{
 assert.equal(detectVoiceCommand('मेरे ऑर्डर दिखाएं','hi').intent,'OPEN_ORDERS');
 assert.equal(detectVoiceCommand('ವಿಳಾಸಗಳು','kn').intent,'OPEN_ADDRESSES');
 assert.equal(detectVoiceCommand('আমার অর্ডার','bn').intent,'OPEN_ORDERS');
 assert.equal(detectVoiceCommand('నా ఆర్డర్లు','te').intent,'OPEN_ORDERS');
});
test('recognizes localized request creation and keeps medicine query',()=>{
 assert.equal(detectVoiceCommand('नया दवा अनुरोध','hi').intent,'NEW_REQUEST');
 assert.equal(detectVoiceCommand('కొత్త మందుల అభ్యర్థన','te').intent,'NEW_REQUEST');
 assert.equal(detectVoiceCommand('খুঁজুন Dolo 650','bn').query,'dolo 650');
});
test('provides localized spoken feedback',()=>{
 assert.match(getVoiceResponse('READY','hi'),/वॉइस/);
 assert.match(getVoiceResponse('READY','kn'),/ಧ್ವನಿ/);
 assert.match(getVoiceResponse('READY','bn'),/ভয়েস/);
 assert.match(getVoiceResponse('READY','te'),/వాయిస్/);
});
