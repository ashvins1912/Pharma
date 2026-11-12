"""Future provider stubs — not required for current DB-first deployment."""

from .adapter import IntegrationAdapter

class _DisabledAdapter(IntegrationAdapter):
    def __init__(self, name: str):
        self._name = name

    @property
    def provider_name(self) -> str:
        return self._name

    async def publish(self, event):
        raise NotImplementedError(f"{self._name} adapter is not enabled")

    async def health_check(self):
        return {"healthy": False, "provider": self._name, "reason": "not_implemented"}

class KafkaAdapter(_DisabledAdapter):
    def __init__(self):
        super().__init__("KAFKA")

class RabbitMQAdapter(_DisabledAdapter):
    def __init__(self):
        super().__init__("RABBITMQ")

class SqsAdapter(_DisabledAdapter):
    def __init__(self):
        super().__init__("AWS_SQS")

class WebhookAdapter(_DisabledAdapter):
    def __init__(self):
        super().__init__("WEBHOOK")
