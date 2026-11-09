import mongoose from 'mongoose';
const schema = new mongoose.Schema({
 assetId:{type:String,required:true,unique:true,index:true}, provider:{type:String,enum:['cloudinary'],required:true},
 providerPublicId:{type:String,required:true,unique:true,select:false}, tenantId:{type:String,default:null,index:true}, branchId:{type:String,default:null,index:true},
 ownerId:{type:String,required:true,index:true}, purpose:{type:String,enum:['medicine-image'],required:true,index:true},
 contentType:{type:String,required:true},format:{type:String,default:'webp'},width:{type:Number,min:1},height:{type:Number,min:1},
 sizeBytes:{type:Number,min:1},originalSizeBytes:{type:Number,min:1},status:{type:String,enum:['ACTIVE','DELETED'],default:'ACTIVE',index:true},deletedAt:{type:Date,default:null}
},{timestamps:true});
schema.index({tenantId:1,branchId:1,ownerId:1,status:1});
export default mongoose.models.PrivateImageAsset||mongoose.model('PrivateImageAsset',schema);
