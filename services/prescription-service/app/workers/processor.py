"""Lease-based durable prescription processing worker."""
from __future__ import annotations

import asyncio
import logging
import signal
import uuid

from app.config import settings
from app.db import ensure_indexes, close_client
from app.services.prescription_service import prescription_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("prescription-worker")

_running = True

def _stop(*_args):
    global _running
    _running = False

async def run_worker():
    await ensure_indexes()
    worker_id = settings.WORKER_ID or f"rx-worker-{uuid.uuid4().hex[:8]}"
    logger.info("Prescription worker starting worker_id=%s", worker_id)
    while _running:
        try:
            job = await prescription_engine.claim_job(worker_id)
            if not job:
                await asyncio.sleep(2)
                continue
            logger.info("Processing job=%s prescription=%s", job.get("jobId"), job.get("prescription_id"))
            await prescription_engine.process_job(job, worker_id)
        except Exception:
            logger.exception("Worker loop error")
            await asyncio.sleep(3)
    await close_client()
    logger.info("Worker stopped")

def main():
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    asyncio.run(run_worker())

if __name__ == "__main__":
    main()
