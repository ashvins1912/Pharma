import mongoose from 'mongoose';

const userProfileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    mobile: { type: String, default: '' },
}, { timestamps: true });

const UserProfile = mongoose.models.UserProfile || mongoose.model('UserProfile', userProfileSchema);
export default UserProfile;
