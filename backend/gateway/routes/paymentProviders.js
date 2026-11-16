import express from 'express';
import { authenticateUser } from '../../middleware/auth.js';
import TenantMembership from '../../models/TenantMembership.js';
import {
  configureTenantPaymentProvider, listTenantPaymentProviders,
  selectDefaultTenantPaymentProvider
} from '../../services/payment/TenantPaymentProviderService.js';
import { createTenantCheckout } from '../../services/payment/TenantPaymentCheckoutService.js';

const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
async function tenantAdmin(req) {
  const role=String(req.user?.role||req.user?.app_metadata?.role||'').toUpperCase();
  const platform=['SUPER_ADMIN','PLATFORM_SUPER_ADMIN','ADMIN'].includes(role);
  const tenantId=platform?String(req.get('x-tenant-id')||req.user?.tenantId||'').trim():String(req.user?.tenantId||req.user?.app_metadata?.tenantId||'').trim();
  const userId=String(req.user?.sub||req.user?.id||req.user?.userId||'').trim();
  if(!tenantId||!userId) throw Object.assign(new Error('Tenant context is required.'),{statusCode:403,code:'TENANT_CONTEXT_REQUIRED'});
  if(!platform){const m=await TenantMembership.findOne({tenantId,userId,status:'ACTIVE'}).lean();if(!m||!['TENANT_OWNER','TENANT_ADMIN'].includes(String(m.role).toUpperCase()))throw Object.assign(new Error('Tenant owner/admin access is required.'),{statusCode:403,code:'PAYMENT_SETTINGS_FORBIDDEN'});}
  return {tenantId,userId};
}
router.use(authenticateUser);
router.get('/providers',wrap(async(req,res)=>{const{tenantId}=await tenantAdmin(req);return res.json({success:true,data:await listTenantPaymentProviders(tenantId)});}));
router.put('/providers/:provider',wrap(async(req,res)=>{const{tenantId,userId}=await tenantAdmin(req);const data=await configureTenantPaymentProvider({tenantId,provider:req.params.provider,environment:req.body?.environment||'sandbox',credentials:req.body?.credentials,actorId:userId});return res.json({success:true,data});}));
router.post('/intents',wrap(async(req,res)=>{const data=await createTenantCheckout({user:req.user,orderNumber:req.body?.orderNumber,idempotencyKey:req.get('idempotency-key'),environment:req.body?.environment||'sandbox'});return res.status(201).json({success:true,data,requestId:req.requestId||null});}));
router.put('/providers/:provider/default',wrap(async(req,res)=>{const{tenantId}=await tenantAdmin(req);const data=await selectDefaultTenantPaymentProvider({tenantId,provider:req.params.provider,environment:req.body?.environment||'production'});return res.json({success:true,data});}));
router.use((error,req,res,_next)=>res.status(Number(error.statusCode)||500).json({success:false,code:error.code||'PAYMENT_PROVIDER_CONFIGURATION_FAILED',message:Number(error.statusCode)>=500?'Payment provider configuration is temporarily unavailable.':error.message,requestId:req.requestId||null}));
export default router;
