import mongoose from 'mongoose';

const medicineDailyMetricSchema = new mongoose.Schema({
    skuId: { type: String, required: true, trim: true, uppercase: true },
    metricDate: { type: Date, required: true },
    searchImpressions: { type: Number, default: 0, min: 0 }
}, { timestamps: true, collection: 'medicine_daily_metrics' });

medicineDailyMetricSchema.pre('validate', function () {
    if (this.metricDate) {
        this.metricDate = new Date(Date.UTC(
            this.metricDate.getUTCFullYear(),
            this.metricDate.getUTCMonth(),
            this.metricDate.getUTCDate()
        ));
    }
});

medicineDailyMetricSchema.index({ skuId: 1, metricDate: 1 }, { unique: true });
medicineDailyMetricSchema.index({ metricDate: 1, skuId: 1 });

export const MedicineDailyMetric = mongoose.models.MedicineDailyMetric
    || mongoose.model('MedicineDailyMetric', medicineDailyMetricSchema);

export default MedicineDailyMetric;
