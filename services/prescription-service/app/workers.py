import time
import os

print("Starting prescription background worker...")
while True:
    print("Prescription worker heartbeat - processing pending queue items...")
    time.sleep(30)
