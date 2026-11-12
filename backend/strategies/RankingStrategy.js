export class RankingStrategy {
    buildAggregationStages(_context) {
        throw new Error('RankingStrategy.buildAggregationStages() must be implemented.');
    }
}
