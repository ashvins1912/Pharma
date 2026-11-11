from typing import Optional
from .database_adapter import DatabaseAdapter
from .future_adapters import KafkaAdapter, RabbitMQAdapter, SqsAdapter, WebhookAdapter
from ..db import get_db

class IntegrationAdapterRegistry:
    def __init__(self):
        self._adapters = {
            "DATABASE": DatabaseAdapter(),
            "KAFKA": KafkaAdapter(),
            "RABBITMQ": RabbitMQAdapter(),
            "AWS_SQS": SqsAdapter(),
            "WEBHOOK": WebhookAdapter(),
        }

    def get(self, provider: str = "DATABASE"):
        return self._adapters[provider]

    async def resolve_adapter(
        self,
        tenant_id: Optional[str] = None,
        branch_id: Optional[str] = None,
        event_type: Optional[str] = None,
    ):
        try:
            db = get_db()
            cursor = db.integration_provider.find({"enabled": True}).sort("priority", 1)
            async for row in cursor:
                scope = row.get("scope", "GLOBAL")
                if scope == "BRANCH" and (row.get("tenant_id") != tenant_id or row.get("branch_id") != branch_id):
                    continue
                if scope == "TENANT" and row.get("tenant_id") != tenant_id:
                    continue
                event_types = row.get("event_types") or []
                if event_types and event_type and event_type not in event_types:
                    continue
                provider = row.get("provider", "DATABASE")
                adapter = self._adapters.get(provider) or self._adapters["DATABASE"]
                health = await adapter.health_check()
                if health.get("healthy") or provider == "DATABASE":
                    return adapter if health.get("healthy") or provider == "DATABASE" else self._adapters["DATABASE"]
        except Exception:
            pass
        return self._adapters["DATABASE"]

integration_registry = IntegrationAdapterRegistry()
