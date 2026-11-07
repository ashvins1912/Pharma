import { __federation_method_setRemote, __federation_method_getRemote } from '__federation_fn_import';

const LOCAL_FALLBACK_MANIFEST = {
  remote_app: "http://localhost:5001/assets/remoteEntry.js",
  auth_mfe: "http://localhost:5002/assets/remoteEntry.js"
};

/**
 * Initializes the dynamic MFE registry by loading the configuration manifest.
 * Falls back defensively to local hardcoded paths if the registry endpoint goes offline.
 */
export async function initializeDynamicMfeRegistry(registryUrl) {
  let manifest = LOCAL_FALLBACK_MANIFEST;
  try {
    const response = await fetch(registryUrl, { cache: 'no-store' });
    if (response.ok) {
      manifest = await response.json();
      console.log("%c[MFE::REGISTRY] Successfully loaded dynamic remote mapping manifest.", "color: #10b981; font-weight: bold;");
    } else {
      console.warn("[MFE::REGISTRY] Service discovery registry returned error. Injecting local emergency fallback matrix.");
    }
  } catch (error) {
    console.error("[MFE::REGISTRY] Critical failure fetching dynamic manifest mappings. Loading safety fallback configuration:", error);
  }

  Object.entries(manifest).forEach(([mfeName, remoteEntryUrl]) => {
    try {
      if (typeof __federation_method_setRemote === 'function') {
        __federation_method_setRemote(mfeName, {
          url: () => Promise.resolve(remoteEntryUrl),
          format: 'esm',
          from: 'vite'
        });
      }
    } catch (e) {
      console.warn(`[MFE::REGISTRY] Federation remote setup warning for ${mfeName}:`, e);
    }
  });
  return true;
}

/**
 * Safely dynamic-imports components from runtime-registered micro frontend containers.
 */
export function importDynamicRemoteComponent(remoteName, componentPath) {
  return async () => {
    if (typeof __federation_method_getRemote === 'function') {
      return await __federation_method_getRemote(remoteName, componentPath);
    }
    throw new Error(`Federation runtime not available for remote: ${remoteName}`);
  };
}
