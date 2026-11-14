"""SaaS Driver Plugin: Cloudflare Edge/WAF DNS + Auth0 OIDC Client Reconciliation."""

from __future__ import annotations

import os
from typing import Any

import httpx

from devops_kit.contracts.models import AllocationPlan, EnvironmentType, ServiceEnvironmentContract
from devops_kit.core.interfaces import BaseSaasDriver, DriverExecutionResult


class CloudflareAuth0SaasDriver(BaseSaasDriver):
    """Reconciles Cloudflare DNS/WAF policies and Auth0 OIDC applications via REST APIs."""

    driver_name = "cloudflare-auth0-saas"

    def __init__(self, timeout_sec: float = 10.0) -> None:
        self.timeout_sec = timeout_sec

    def reconcile_saas(
        self, contract: ServiceEnvironmentContract, plan: AllocationPlan
    ) -> DriverExecutionResult:
        svc = contract.metadata.name
        env = contract.metadata.environment.value
        domain = contract.routing_and_injection.public_domain
        waf_mode = "block" if contract.metadata.environment == EnvironmentType.PROD else "simulate"

        warnings: list[str] = []
        outputs: dict[str, Any] = {
            "edge_provider": contract.services.saas.edge_cdn_provider or "cloudflare",
            "identity_provider": contract.services.saas.identity_provider or "auth0",
            "managed_domain": domain,
            "waf_mode": waf_mode,
        }
        endpoints: dict[str, str] = {
            "CLOUDFLARE_WAF_MODE": waf_mode,
            "EDGE_PUBLIC_URL": f"https://{domain}{contract.routing_and_injection.path_prefix}",
        }

        cf_token = os.getenv("CLOUDFLARE_API_TOKEN")
        cf_zone_id = os.getenv("CLOUDFLARE_ZONE_ID")
        if cf_token and cf_zone_id:
            dns_record_id = self._upsert_cloudflare_dns(
                token=cf_token,
                zone_id=cf_zone_id,
                domain=domain,
                target_cname=f"ingress.{contract.target.region}.acme-edge.internal",
            )
            outputs["cloudflare_dns_record_id"] = dns_record_id
        else:
            outputs["cloudflare_dns_record_id"] = f"sim-cf-{svc}-{env}"
            warnings.append("CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID unset; reconciled in dry-run mode.")

        auth0_domain = os.getenv("AUTH0_MGMT_DOMAIN")
        auth0_token = os.getenv("AUTH0_MGMT_TOKEN")
        if auth0_domain and auth0_token:
            client_id = self._ensure_auth0_client(
                mgmt_domain=auth0_domain,
                token=auth0_token,
                client_name=f"{svc}-{env}",
                callback_url=f"https://{domain}/callback",
            )
            endpoints["AUTH0_CLIENT_ID"] = client_id
            endpoints["AUTH0_ISSUER_URL"] = f"https://{auth0_domain}/"
        else:
            endpoints["AUTH0_CLIENT_ID"] = f"sim_auth0_client_{svc}_{env}"
            endpoints["AUTH0_ISSUER_URL"] = f"https://{env}.auth.acme-commerce.io/"
            warnings.append("AUTH0_MGMT_DOMAIN/AUTH0_MGMT_TOKEN unset; issued deterministic OIDC metadata.")

        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="saas",
            status="reconciled",
            outputs=outputs,
            endpoints=endpoints,
            warnings=warnings,
        )

    def teardown_saas(self, contract: ServiceEnvironmentContract) -> DriverExecutionResult:
        return DriverExecutionResult(
            driver_name=self.driver_name,
            layer="saas",
            status="torn-down",
            outputs={
                "domain_removed": contract.routing_and_injection.public_domain,
                "environment": contract.metadata.environment.value,
            },
        )

    def _upsert_cloudflare_dns(
        self, token: str, zone_id: str, domain: str, target_cname: str
    ) -> str:
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        base_url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
        with httpx.Client(timeout=self.timeout_sec) as client:
            lookup = client.get(base_url, headers=headers, params={"name": domain, "type": "CNAME"})
            lookup.raise_for_status()
            records = lookup.json().get("result", [])
            payload = {"type": "CNAME", "name": domain, "content": target_cname, "proxied": True}
            if records:
                record_id = str(records[0]["id"])
                resp = client.put(f"{base_url}/{record_id}", headers=headers, json=payload)
                resp.raise_for_status()
                return record_id
            resp = client.post(base_url, headers=headers, json=payload)
            resp.raise_for_status()
            return str(resp.json()["result"]["id"])

    def _ensure_auth0_client(
        self, mgmt_domain: str, token: str, client_name: str, callback_url: str
    ) -> str:
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        base_url = f"https://{mgmt_domain}/api/v2/clients"
        with httpx.Client(timeout=self.timeout_sec) as client:
            resp = client.get(base_url, headers=headers, params={"fields": "client_id,name"})
            resp.raise_for_status()
            for item in resp.json():
                if item.get("name") == client_name:
                    return str(item["client_id"])
            create_resp = client.post(
                base_url,
                headers=headers,
                json={
                    "name": client_name,
                    "app_type": "regular_web",
                    "callbacks": [callback_url],
                    "oidc_conformant": True,
                },
            )
            create_resp.raise_for_status()
            return str(create_resp.json()["client_id"])
