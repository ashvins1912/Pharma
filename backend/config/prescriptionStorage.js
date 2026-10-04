import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { getIsConnected } from './db.js';

const bucketName = 'prescriptions';
const memoryFiles = new Map();

const getBucket = () => {
    const GridFSBucket = mongoose.mongo?.GridFSBucket;
    if (!GridFSBucket) {
        throw new Error('GridFSBucket is not available from mongoose.mongo');
    }
    return new GridFSBucket(mongoose.connection.db, { bucketName });
};

export const savePrescription = async (file, ownerId) => {
    if (!file) return null;
    const fileId = new mongoose.Types.ObjectId();
    const metadata = { ownerId, contentType: file.mimetype };

    if (!getIsConnected()) {
        const id = randomUUID();
        memoryFiles.set(id, { buffer: file.buffer, ...metadata });
        return `/api/orders/prescriptions/${id}`;
    }

    const bucket = getBucket();
    await new Promise((resolve, reject) => {
        const upload = bucket.openUploadStreamWithId(fileId, 'prescription', {
            contentType: file.mimetype,
            metadata
        });
        upload.once('error', reject);
        upload.once('finish', resolve);
        upload.end(file.buffer);
    });
    return `/api/orders/prescriptions/${fileId.toString()}`;
};

export const removePrescription = async (prescriptionUrl) => {
    if (!prescriptionUrl) return;
    const fileId = prescriptionUrl.split('/').at(-1);
    if (!getIsConnected()) {
        memoryFiles.delete(fileId);
        return;
    }
    if (!mongoose.isValidObjectId(fileId)) return;
    await getBucket().delete(new mongoose.Types.ObjectId(fileId));
};

export const getPrescription = async (fileId) => {
    if (!getIsConnected()) {
        const file = memoryFiles.get(fileId);
        return file ? { ...file, stream: null } : null;
    }
    if (!mongoose.isValidObjectId(fileId)) return null;
    const bucket = getBucket();
    const files = await bucket.find({ _id: new mongoose.Types.ObjectId(fileId) }).toArray();
    if (!files.length) return null;
    return {
        ownerId: files[0].metadata?.ownerId,
        contentType: files[0].contentType,
        stream: bucket.openDownloadStream(files[0]._id)
    };
};
