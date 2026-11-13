import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = {
  vus: 40,
  duration: '3m',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<1500','p(99)<3000']
  }
};
const url=__ENV.MEDICINE_SEARCH_URL;
const token=__ENV.MEDICINE_SEARCH_TOKEN;
if(!url) throw new Error('MEDICINE_SEARCH_URL is required');
export default function(){
 const q=['paracetamol 650','dolo 650','cetirizine 10','amoxicillin 500','metformin 500'][__VU%5];
 const response=http.get(url+(url.includes('?')?'&':'?')+'q='+encodeURIComponent(q)+'&limit=15',{
  headers: token?{Authorization:'Bearer '+token}:{}
 });
 check(response,{'search returns 200':r=>r.status===200,'search response is JSON':r=>(r.headers['Content-Type']||'').includes('application/json')});
 sleep(1);
}
