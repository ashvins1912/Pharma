"""Zero-code env-var synthesis and dynamic route management."""

from __future__ import annotations

from devops_kit.injection.route_manager import EnvoyRouteManager, GatewayApiRouteManager
from devops_kit.injection.synthesizer import EnvSynthesizer, SynthesizedBundle

__all__ = [
    "EnvSynthesizer",
    "EnvoyRouteManager",
    "GatewayApiRouteManager",
    "SynthesizedBundle",
]
