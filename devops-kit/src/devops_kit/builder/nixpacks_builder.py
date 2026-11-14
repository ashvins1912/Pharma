"""Zero-Dockerfile container builder using Nixpacks / Buildpacks detection."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class BuildArtifactResult:
    detected_stack: str
    image_tag: str
    builder_used: str
    executed: bool
    command: list[str]
    sbom_digest: str


class NixpacksBuilder:
    """Detects application stack and builds OCI container images without a Dockerfile."""

    STACK_MARKERS: tuple[tuple[str, str], ...] = (
        ("pyproject.toml", "python"),
        ("requirements.txt", "python"),
        ("package.json", "nodejs"),
        ("go.mod", "go"),
        ("Cargo.toml", "rust"),
        ("pom.xml", "java"),
    )

    def detect_stack(self, app_dir: Path) -> str:
        for marker, stack in self.STACK_MARKERS:
            if (app_dir / marker).exists():
                return stack
        return "generic-oci"

    def build(
        self,
        app_dir: Path,
        service_name: str,
        version: str,
        registry: str = "ghcr.io/platform",
        dry_run: bool = False,
    ) -> BuildArtifactResult:
        stack = self.detect_stack(app_dir)
        image_tag = f"{registry}/{service_name}:{version}"
        digest = hashlib.sha256(f"{app_dir}:{service_name}:{version}".encode()).hexdigest()[:16]

        has_nixpacks = shutil.which("nixpacks") is not None
        has_pack = shutil.which("pack") is not None

        if has_nixpacks:
            builder_used = "nixpacks"
            cmd = ["nixpacks", "build", str(app_dir), "--name", image_tag]
        elif has_pack:
            builder_used = "buildpacks"
            cmd = [
                "pack",
                "build",
                image_tag,
                "--path",
                str(app_dir),
                "--builder",
                "paketobuildpacks/builder-jammy-base",
            ]
        else:
            builder_used = "nixpacks-planned"
            cmd = ["nixpacks", "build", str(app_dir), "--name", image_tag]

        executed = False
        if not dry_run and (has_nixpacks or has_pack):
            subprocess.run(cmd, check=True)
            executed = True

        return BuildArtifactResult(
            detected_stack=stack,
            image_tag=image_tag,
            builder_used=builder_used,
            executed=executed,
            command=cmd,
            sbom_digest=f"sha256:{digest}",
        )
