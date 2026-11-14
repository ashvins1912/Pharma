"""Dynamic Route & Traffic Shifting Managers (Gateway API & Envoy)."""

from __future__ import annotations

from string import Template

import yaml

from devops_kit.contracts.models import ServiceEnvironmentContract, TrafficStrategy
from devops_kit.core.interfaces import BaseRouteManager, DriverExecutionResult


class GatewayApiRouteManager(BaseRouteManager):
    """Generates and updates Kubernetes Gateway API HTTPRoute manifests."""

    router_name = "gateway-api"

    def generate_route_config(
        self, contract: ServiceEnvironmentContract, canary_weight: int | None = None
    ) -> str:
        weight = (
            canary_weight
            if canary_weight is not None
            else (
                contract.routing_and_injection.canary_weight_percent
                if contract.routing_and_injection.traffic_strategy == TrafficStrategy.CANARY_10_90
                else 0
            )
        )
        stable_weight = max(0, 100 - weight)
        svc = contract.metadata.name
        ns = contract.services.paas.kubernetes_namespace

        route_doc = {
            "apiVersion": "gateway.networking.k8s.io/v1",
            "kind": "HTTPRoute",
            "metadata": {
                "name": f"{svc}-route",
                "namespace": ns,
                "annotations": {
                    "devops-kit.io/rate-limit-rpm": str(
                        contract.routing_and_injection.rate_limit_rpm
                    ),
                    "devops-kit.io/traffic-strategy": (
                        contract.routing_and_injection.traffic_strategy.value
                    ),
                },
            },
            "spec": {
                "parentRefs": [{"name": "platform-edge-gateway", "namespace": "istio-system"}],
                "hostnames": [contract.routing_and_injection.public_domain],
                "rules": [
                    {
                        "matches": [
                            {
                                "path": {
                                    "type": "PathPrefix",
                                    "value": contract.routing_and_injection.path_prefix,
                                }
                            }
                        ],
                        "backendRefs": [
                            {"name": f"{svc}-stable", "port": 80, "weight": stable_weight},
                            {"name": f"{svc}-canary", "port": 80, "weight": weight},
                        ],
                    }
                ],
            },
        }
        return yaml.safe_dump(route_doc, sort_keys=False)

    def shift_traffic(
        self,
        contract: ServiceEnvironmentContract,
        canary_weight: int,
        pr_header: str | None = None,
    ) -> DriverExecutionResult:
        if not 0 <= canary_weight <= 100:
            raise ValueError("canary_weight must be between 0 and 100")

        yaml_manifest = self.generate_route_config(contract, canary_weight=canary_weight)
        if pr_header:
            doc = yaml.safe_load(yaml_manifest)
            doc["spec"]["rules"].insert(
                0,
                {
                    "matches": [
                        {
                            "headers": [{"name": "x-pr-preview", "value": pr_header}],
                            "path": {
                                "type": "PathPrefix",
                                "value": contract.routing_and_injection.path_prefix,
                            },
                        }
                    ],
                    "backendRefs": [
                        {"name": f"{contract.metadata.name}-{pr_header}", "port": 80, "weight": 100}
                    ],
                },
            )
            yaml_manifest = yaml.safe_dump(doc, sort_keys=False)

        return DriverExecutionResult(
            driver_name=self.router_name,
            layer="routing",
            status="route-updated",
            outputs={
                "stable_weight": 100 - canary_weight,
                "canary_weight": canary_weight,
                "pr_header": pr_header,
                "manifest": yaml_manifest,
            },
            endpoints={"public_url": f"https://{contract.routing_and_injection.public_domain}"},
        )


class EnvoyRouteManager(BaseRouteManager):
    """Generates Envoy Proxy route configuration for non-Gateway-API ingress meshes."""

    router_name = "envoy-proxy"

    _ENVOY_TEMPLATE = Template(
        """static_resources:
  listeners:
    - name: ingress_http
      address:
        socket_address: { address: 0.0.0.0, port_value: 8080 }
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: ${SERVICE}_ingress
                route_config:
                  name: ${SERVICE}_route
                  virtual_hosts:
                    - name: ${SERVICE}_vhost
                      domains: ["${DOMAIN}"]
                      routes:
                        - match: { prefix: "${PREFIX}" }
                          route:
                            weighted_clusters:
                              clusters:
                                - name: ${SERVICE}_stable
                                  weight: ${STABLE}
                                - name: ${SERVICE}_canary
                                  weight: ${CANARY}
"""
    )

    def generate_route_config(
        self, contract: ServiceEnvironmentContract, canary_weight: int | None = None
    ) -> str:
        weight = (
            canary_weight
            if canary_weight is not None
            else contract.routing_and_injection.canary_weight_percent
        )
        return self._ENVOY_TEMPLATE.safe_substitute(
            SERVICE=contract.metadata.name,
            DOMAIN=contract.routing_and_injection.public_domain,
            PREFIX=contract.routing_and_injection.path_prefix,
            STABLE=100 - weight,
            CANARY=weight,
        )

    def shift_traffic(
        self,
        contract: ServiceEnvironmentContract,
        canary_weight: int,
        pr_header: str | None = None,
    ) -> DriverExecutionResult:
        cfg = self.generate_route_config(contract, canary_weight=canary_weight)
        return DriverExecutionResult(
            driver_name=self.router_name,
            layer="routing",
            status="envoy-reconfigured",
            outputs={"canary_weight": canary_weight, "pr_header": pr_header, "config": cfg},
        )
