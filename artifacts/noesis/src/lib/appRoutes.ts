export const LEGACY_APP_PATH = "/";
export const DISCOVERY_LAB_PATH = "/discovery-lab";

export function isDiscoveryLabPath(path: string): boolean {
  return path === DISCOVERY_LAB_PATH;
}
