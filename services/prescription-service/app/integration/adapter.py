from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

class IntegrationAdapter(ABC):
    @property
    @abstractmethod
    def provider_name(self) -> str:
        ...

    @abstractmethod
    async def publish(self, event: Dict[str, Any]) -> Dict[str, Any]:
        ...

    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        ...
