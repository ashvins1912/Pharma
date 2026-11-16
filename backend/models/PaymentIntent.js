import mongoose from 'mongoose';
const schema=new mongoose.Schema({tenantId:{type:String,required:true,index:true},orderNumber:{type:String,required:true,index:true},customerId:{type:String,required:true},provider:{type:String,required:true},environment:{type:String,required:true},idempotencyKey:{type:String,required:true},amountMinor:{type:Number,required:true,min:1},currency:{type:String,default:'INR'},providerOrderId:{type:String,default:null},checkout:{type:mongoose.Schema.Types.Mixed,default:{}},status:{type:String,enum:['CREATING','CREATED','FAILED','PAID','EXPIRED'],default:'CREATING',index:true}},{timestamps:true});
schema.index({tenantId:1,idempotencyKey:1},{unique:true,name:'tenant_payment_intent_idempotency'});
schema.index({provider:1,providerOrderId:1},{unique:true,partialFilterExpression:{providerOrderId:{$type:'string'}}});
export default mongoose.models.PaymentIntent||mongoose.model('PaymentIntent',schema);
