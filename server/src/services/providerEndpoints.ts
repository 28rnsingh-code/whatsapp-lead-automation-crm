export type AllowedProviderPath = string | RegExp;

/**
 * Resolve a provider endpoint from environment configuration while preventing
 * credentials from being sent to an arbitrary host or insecure transport.
 */
export function resolveHttpsProviderEndpoint(
  environmentVariable: string,
  expectedHostname: string,
  expectedPath: AllowedProviderPath,
): URL {
  const raw = process.env[environmentVariable]?.trim();
  if (!raw) {
    throw new Error(environmentVariable + ' must be configured before using this provider.');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error(environmentVariable + ' must be a valid absolute HTTPS URL.');
  }

  const pathMatches = typeof expectedPath === 'string'
    ? endpoint.pathname === expectedPath
    : expectedPath.test(endpoint.pathname);

  if (
    endpoint.protocol !== 'https:'
    || endpoint.hostname.toLowerCase() !== expectedHostname.toLowerCase()
    || !pathMatches
    || endpoint.username
    || endpoint.password
    || endpoint.port
    || endpoint.search
    || endpoint.hash
  ) {
    throw new Error(environmentVariable + ' must use HTTPS and the approved provider host and path.');
  }

  return endpoint;
}

/** Append encoded path segments to a validated provider base endpoint. */
export function appendProviderPath(baseEndpoint: URL, segments: string[]): URL {
  const endpoint = new URL(baseEndpoint.toString());
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const suffix = segments.map((segment) => encodeURIComponent(segment)).join('/');
  endpoint.pathname = basePath + '/' + suffix;
  return endpoint;
}
