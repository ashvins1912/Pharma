export class GetRidersUseCase {
    constructor({ riderRepository }) {
        this.riderRepository = riderRepository;
    }

    async execute(filter = {}) {
        return await this.riderRepository.findAll(filter);
    }
}
